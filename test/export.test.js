const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { strictEqual: eq, deepStrictEqual: deq, ok, match } = require('node:assert');
const { describe, it, before, beforeEach, after } = require('node:test');
const { Client } = require('pg');
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const { Filby } = require('..');
const exportBundle = require('../lib/export');
const bundleSchema = require('../lib/bundle-schema.json');
const { version: filbyVersion } = require('../package.json');

const run = promisify(execFile);
const cli = path.resolve('bin/filby.js');
const server = { user: 'fby_test', password: 'fby_test' };
const exportDatabase = `${process.env.PGDATABASE || 'fby_test'}_export`;
const database = { ...server, database: exportDatabase };
const migrations = ['test/export/migrations'];
const usage = /^Usage: filby <validate\|preview> \[directory \.\.\.\]$/m;

describe('Export', () => {

  let directory;

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'filby-export-'));
  });

  beforeEach(async () => {
    await execute(`DROP DATABASE IF EXISTS ${exportDatabase} WITH (FORCE)`);
    await execute(`CREATE DATABASE ${exportDatabase}`);
  });

  after(async () => {
    await execute(`DROP DATABASE IF EXISTS ${exportDatabase} WITH (FORCE)`);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('writes a bundle that validates against the bundle format', async () => {
    const bundle = await exportWithCli('Parks@1');

    validateBundle(bundle);
    eq(bundle.format, 1);
    eq(bundle.filby, filbyVersion);
    eq(bundle.name, 'Parks');
    eq(bundle.version, 1);
    eq(bundle.description, 'Parks with their seasons and operator');
    deq(bundle.changeSets.map(({ description }) => description), ['2020 Parks', '2021 Parks', '2099 Parks']);
    deq(Object.keys(bundle.documents), bundle.changeSets.map(({ id }) => String(id)));
    eq(bundle.changeSets[0].effective, '2020-01-01T00:00:00.000Z');
  });

  it('includes the document schema the OpenAPI document derives, with nesting', async () => {
    const bundle = await exportWithCli('Parks@1');

    deq(Object.keys(bundle.schema.properties), ['code', 'name', 'berths', 'price', 'status', 'opened', 'operator_code', 'seasons', 'operator']);
    deq(bundle.schema.properties.opened, { type: ['string', 'null'], format: 'date-time' });
    eq(bundle.schema.properties.seasons.type, 'array');
    deq(bundle.schema.properties.seasons.items.properties.starts_at, { type: 'string', format: 'date-time' });
    eq(bundle.schema.properties.operator.anyOf[0].type, 'object');
  });

  it('carries aliased fields under their property names in the schema and the documents', async () => {
    const bundle = await exportWithCli('Parks@1');
    const [devonCliffs] = bundle.documents[bundle.changeSets[0].id];

    deq(Object.keys(bundle.schema.properties.seasons.items.properties), ['type', 'starts_at']);
    deq(Object.keys(bundle.schema.properties.operator.anyOf[0].properties), ['operator_name']);
    deq(devonCliffs.seasons, [{ type: 'Guests', starts_at: '2020-03-15T00:00:00.000Z' }, { type: 'Owners', starts_at: '2020-03-01T00:00:00.000Z' }]);
    deq(devonCliffs.operator, { operator_name: 'Haven' });
  });

  it('includes every document of a paged projection at every change set, as the API serves them', async () => {
    await exportWithCli('Parks@1');
    const filby = new Filby({ database, migrations });
    try {
      const projection = await filby.getProjection('Parks', 1);
      const bundle = await exportBundle(filby, 'Parks', 1);
      for (const changeSet of bundle.changeSets) {
        deq(bundle.documents[changeSet.id], await fetchAll(filby, '/projections/Parks/v1', changeSet.id));
      }
      deq(bundle.documents[bundle.changeSets[0].id].map(({ code }) => code), ['DC', 'GA', 'PV']);
      eq((await filby.getDocuments(projection, bundle.changeSets[0].id)).documents.length, 2);
    } finally {
      await filby.stop();
    }
  });

  it('exports a projection declared with dependencies', async () => {
    const bundle = await exportWithCli('Park Codes@1');
    const filby = new Filby({ database, migrations });
    try {
      validateBundle(bundle);
      deq(bundle.schema, { type: 'object' });
      for (const changeSet of bundle.changeSets) {
        deq(bundle.documents[changeSet.id], await fetchAll(filby, '/projections/Park%20Codes/v1', changeSet.id));
      }
      deq(bundle.documents[bundle.changeSets[0].id], [
        { code: 'DC', opened: '2001-05-01T00:00:00.000Z' },
        { code: 'GA', opened: null },
        { code: 'PV', opened: '1999-03-01T00:00:00.000Z' },
      ]);
    } finally {
      await filby.stop();
    }
  });

  it('exports a bundle from the example migrations', async () => {
    const bundle = await exportWithCli('Parks (Detailed)@1', { migrations: ['examples/migrations'] });

    validateBundle(bundle);
    eq(bundle.name, 'Parks (Detailed)');
    ok(bundle.changeSets.length > 1);
    deq(Object.keys(bundle.documents).map(Number).toSorted((a, b) => a - b), bundle.changeSets.map(({ id }) => id).toSorted((a, b) => a - b));
  });

  it('rejects an unknown projection', async () => {
    const { code, stderr } = await exportFails('Wombats@1');
    eq(code, 1);
    match(stderr, /^Projection 'Wombats v1' does not exist$/m);
  });

  it('rejects a projection reference without a version', async () => {
    const { code, stderr } = await exportFails('Parks');
    eq(code, 1);
    match(stderr, /^Projection 'Parks' must be given as name@version$/m);
    match(stderr, usage);
  });

  it('rejects an unreadable config', async () => {
    const { code, stderr } = await fails(['export', '--config', path.join(directory, 'missing.json'), '--projection', 'Parks@1', '--out', path.join(directory, 'parks.json')]);
    eq(code, 1);
    match(stderr, /^Cannot read config '.*missing\.json': ENOENT/m);
  });

  it('rejects a config that is not JSON', async () => {
    const config = path.join(directory, 'broken.json');
    fs.writeFileSync(config, 'wombat');
    const { code, stderr } = await fails(['export', '--config', config, '--projection', 'Parks@1', '--out', path.join(directory, 'parks.json')]);
    eq(code, 1);
    match(stderr, /^Cannot read config '.*broken\.json': /m);
  });

  for (const missing of ['config', 'projection', 'out']) {
    it(`rejects a missing --${missing}`, async () => {
      const args = { config: 'filby.json', projection: 'Parks@1', out: 'parks.json' };
      delete args[missing];
      const { code, stderr } = await fails(['export', ...Object.entries(args).flatMap(([name, value]) => [`--${name}`, value])]);
      eq(code, 1);
      match(stderr, new RegExp(`^Missing option '--${missing}'$`, 'm'));
      match(stderr, usage);
    });
  }

  async function exportWithCli(projection, config = {}) {
    const out = path.join(directory, 'bundle.json');
    await run(process.execPath, [cli, 'export', '--config', writeConfig(config), '--projection', projection, '--out', out], { env: { ...process.env, TZ: 'UTC' } });
    return JSON.parse(fs.readFileSync(out, 'utf8'));
  }

  async function exportFails(projection, config = {}) {
    return fails(['export', '--config', writeConfig(config), '--projection', projection, '--out', path.join(directory, 'bundle.json')]);
  }

  function writeConfig(config) {
    const file = path.join(directory, 'filby.json');
    fs.writeFileSync(file, JSON.stringify({ database, migrations, ...config }));
    return file;
  }

  async function fails(args) {
    try {
      await run(process.execPath, [cli, ...args]);
    } catch (err) {
      return err;
    }
    throw new Error('Expected the command to fail');
  }
});

function validateBundle(bundle) {
  const ajv = new Ajv({ allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(bundleSchema);
  ok(validate(bundle), JSON.stringify(validate.errors));
}

async function fetchAll(filby, pathname, changeSetId) {
  const documents = [];
  for (let page = 1; ; page++) {
    const response = await filby.fetch(new Request(`http://localhost${pathname}?changeSetId=${changeSetId}&page=${page}&pageSize=2`));
    eq(response.status, 200, await response.clone().text());
    documents.push(...(await response.json()));
    if (documents.length >= Number(response.headers.get('X-Total-Count'))) return documents;
  }
}

async function execute(sql) {
  const client = new Client({ ...server, database: server.user });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}
