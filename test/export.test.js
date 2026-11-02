const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { strictEqual: eq, deepStrictEqual: deq, ok, match } = require('node:assert');
const { describe, it, before, beforeEach, after } = require('node:test');
const { Client } = require('pg');
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const { Filby } = require('..');
const exportBundle = require('../lib/export');
const runtime = require('../lib/bundle-runtime');
const { pack } = require('../lib/pack');
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
    deq(bundle.schema.properties.seasons.items.properties.start, { type: 'string', format: 'date-time' });
    eq(bundle.schema.properties.operator.anyOf[0].type, 'object');
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

  it('returns the documents the API returns for a change set with no parameters, including nested documents', async () => {
    const parks = runtime(await exportWithCli('Parks@1'));
    const filby = new Filby({ database, migrations });
    try {
      for (const changeSet of parks.changeSets) {
        deq(JSON.parse(JSON.stringify(parks.getDocuments(changeSet.id))), await fetchAll(filby, '/projections/Parks/v1', changeSet.id));
      }
      const [devonCliffs] = parks.getDocuments(parks.changeSets[0].id);
      eq(devonCliffs.seasons.length, 2);
      eq(devonCliffs.operator.name, 'Haven');
    } finally {
      await filby.stop();
    }
  });

  it('revives date-time fields as dates at every level', async () => {
    const parks = runtime(await exportWithCli('Parks@1'));

    const [changeSet] = parks.changeSets;
    ok(changeSet.effective instanceof Date);
    ok(changeSet.lastModified instanceof Date);
    const [devonCliffs, greenacres] = parks.getDocuments(changeSet.id);
    ok(devonCliffs.opened instanceof Date);
    eq(devonCliffs.opened.toISOString(), '2001-05-01T00:00:00.000Z');
    ok(devonCliffs.seasons.every(({ start }) => start instanceof Date));
    eq(greenacres.opened, null);
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
    const out = path.join(directory, 'parks-detailed-v1');
    const consumer = path.join(directory, 'consumer');
    const { version } = pack(bundle, { name: 'parks-detailed-v1', out });
    const { stdout: tarball } = await run('npm', ['pack', '--silent', '--pack-destination', directory], { cwd: out });
    fs.mkdirSync(consumer);
    fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'consumer', private: true }));
    await run('npm', ['install', '--offline', '--no-audit', '--no-fund', '--silent', path.join(directory, tarball.trim())], { cwd: consumer });
    const parks = createRequire(path.join(consumer, 'index.js'))('parks-detailed-v1');
    const [first, second] = parks.changeSets.toSorted((a, b) => a.effective - b.effective);
    const last = parks.changeSets.toSorted((a, b) => b.effective - a.effective || b.id - a.id)[0];
    ok(first.effective < second.effective);

    eq(version, `1.${Math.max(...bundle.changeSets.map(({ id }) => id))}.0`);
    eq(parks.asOf(new Date((first.effective.getTime() + second.effective.getTime()) / 2)).id, first.id);
    eq(parks.asOf(new Date(last.effective.getTime() + 1)).id, last.id);
    for (const changeSet of parks.changeSets) ok(Array.isArray(parks.getDocuments(changeSet.id)));
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
