import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ok, strictEqual as eq, deepStrictEqual as deq, throws } from 'node:assert';
import { describe, it, before, after } from 'node:test';
import { TypeOverrides } from 'pg';

import { Filby } from '../index.js';
import TestFilby from './TestFilby.js';

const run = promisify(execFile);
const cli = path.resolve('bin/filby.js');
const ZONES = ['America/New_York', 'Asia/Tokyo'];

const config = {
  nukeCustomObjects: async (tx) => {
    await tx.query('DROP FUNCTION IF EXISTS get_opening_rows_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_openings_v1');
    await tx.query('DROP TABLE IF EXISTS opening_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_opening_v1_aggregate');
  },
};

const ADD_OPENINGS = `
- operation: ADD_ENTITY
  name: Opening
  version: 1
  fields:
    - name: code
      type: TEXT
    - name: opens
      type: DATE
    - name: starts
      type: TIMESTAMP
    - name: closures
      type: DATE[]
    - name: visits
      type: TIMESTAMP(3) WITHOUT TIME ZONE[]
    - name: recorded
      type: TIMESTAMP WITH TIME ZONE
  identified_by:
    - code
- operation: ADD_PROJECTION
  name: Openings
  version: 1
  root: Opening@1
- operation: ADD_PROJECTION
  name: Opening Rows
  version: 1
  dependencies:
    - entity: Opening
      version: 1
- operation: ADD_CHANGE_SET
  description: 2026 Openings
  effective: 2026-01-01T00:00:00.000Z
  changes:
    - entity: Opening@1
      action: SET
      data:
        - code: A
          opens: '2026-07-01'
          starts: '2026-07-01 10:00:00'
          closures: '{2026-12-25,2026-12-26}'
          visits: '{"2026-07-01 10:00:00",NULL}'
          recorded: '2026-07-01T10:00:00.000Z'
        - code: B
          opens: infinity
          starts: '-infinity'
          closures: '{infinity,"0100-01-01 BC"}'
          visits: '{"0100-01-01 10:00:00 BC",infinity}'
          recorded: '2026-07-01T10:00:00.000Z'
`;

const OPENING_ROWS = `
  CREATE FUNCTION get_opening_rows_v1(p_change_set_id INTEGER)
  RETURNS TABLE (code TEXT, opens DATE, starts TIMESTAMP, closures DATE[], visits TIMESTAMP[], recorded TIMESTAMP WITH TIME ZONE) AS $$
    SELECT code, opens, starts, closures, visits, recorded FROM get_opening_v1_aggregate(p_change_set_id) ORDER BY code;
  $$ LANGUAGE sql STABLE;
`;

const EXPECTED = [
  { code: 'A', opens: '2026-07-01', starts: '2026-07-01T10:00:00', closures: ['2026-12-25', '2026-12-26'], visits: ['2026-07-01T10:00:00', null], recorded: '2026-07-01T10:00:00.000Z' },
  { code: 'B', opens: 'infinity', starts: '-infinity', closures: ['infinity', '0100-01-01 BC'], visits: ['0100-01-01T10:00:00 BC', 'infinity'], recorded: '2026-07-01T10:00:00.000Z' },
];

describe('Local date types', () => {

  let filby;
  let pg;
  let pgWithTypes;
  let stringWithTypes;
  let changeSetId;

  before(async () => {
    const types = new TypeOverrides();
    types.setTypeParser(1082, (text) => ({ date: text }));
    const database = { user: 'fby_test', password: 'fby_test', types };
    filby = new TestFilby(config);
    pg = new TestFilby({ ...config, localDateTypes: 'pg' });
    pgWithTypes = new TestFilby({ ...config, localDateTypes: 'pg', database });
    stringWithTypes = new TestFilby({ ...config, database });
    await filby.reset();
    await Promise.all([pg.init(), pgWithTypes.init(), stringWithTypes.init()]);
    await filby.applyYaml('local date types', ADD_OPENINGS);
    await filby.withTransaction((tx) => tx.query(OPENING_ROWS));
    const projection = await filby.getProjection('Openings', 1);
    ({ id: changeSetId } = await filby.getCurrentChangeSet(projection));
  });

  after(async () => {
    await filby.wipe();
    await Promise.all([filby.stop(), pg.stop(), pgWithTypes.stop(), stringWithTypes.stop()]);
  });

  for (const zone of ZONES) {

    describe(`with the default configuration in ${zone}`, () => {

      it('returns text from getDocuments', async () => {
        const projection = await filby.getProjection('Openings', 1);
        const { documents } = await inZone(zone, () => filby.getDocuments(projection, changeSetId));
        deq(documents.map(json), EXPECTED);
      });

      it('returns text from getAggregates', async () => {
        const aggregates = await inZone(zone, () => filby.getAggregates(changeSetId, 'Opening', 1));
        deq(aggregates.map(pick).map(json), EXPECTED);
      });

      it('serves text from a root projection over HTTP', async () => {
        const documents = await inZone(zone, () => getJson(filby, `/projections/Openings/v1?changeSetId=${changeSetId}`));
        deq(documents, EXPECTED);
      });

      it('serves text from a custom SQL projection over HTTP', async () => {
        const rows = await inZone(zone, () => getJson(filby, `/projections/Opening%20Rows/v1?changeSetId=${changeSetId}`));
        deq(rows, EXPECTED);
      });

      it('returns text from queries run through withTransaction', async () => {
        const { rows } = await inZone(zone, () => filby.withTransaction((tx) => tx.query("SELECT DATE '2026-07-01' AS opens, TIMESTAMP '2026-07-01 10:00:00' AS starts")));
        deq(rows, [{ opens: '2026-07-01', starts: '2026-07-01T10:00:00' }]);
      });
    });
  }

  describe("with localDateTypes: 'pg'", () => {

    for (const zone of ZONES) {
      it(`returns node-pg's Date values in ${zone}`, async () => {
        const projection = await pg.getProjection('Openings', 1);
        await inZone(zone, async () => {
          const { documents: [a, b] } = await pg.getDocuments(projection, changeSetId);
          ok(a.opens instanceof Date);
          eq(a.opens.getTime(), new Date(2026, 6, 1).getTime());
          eq(a.starts.getTime(), new Date(2026, 6, 1, 10).getTime());
          deq(a.closures.map((date) => date.getTime()), [new Date(2026, 11, 25).getTime(), new Date(2026, 11, 26).getTime()]);
          eq(a.visits[0].getTime(), new Date(2026, 6, 1, 10).getTime());
          eq(b.opens, Infinity);
        });
      });
    }
  });

  describe('with database.types', () => {

    it("uses the parser under localDateTypes: 'pg'", async () => {
      const aggregates = await pgWithTypes.getAggregates(changeSetId, 'Opening', 1);
      deq(aggregates[0].opens, { date: '2026-07-01' });
    });

    it("ignores the parser for local date types under localDateTypes: 'string'", async () => {
      const aggregates = await stringWithTypes.getAggregates(changeSetId, 'Opening', 1);
      eq(aggregates[0].opens, '2026-07-01');
    });
  });

  describe('Configuration', () => {

    it('accepts each supported value', () => {
      for (const localDateTypes of ['string', 'pg']) new Filby({ localDateTypes });
    });

    it('rejects an unsupported value', () => {
      throws(() => new Filby({ localDateTypes: 'temporal' }), { message: "Invalid config: /localDateTypes must be one of 'string', 'pg'" });
    });
  });

  describe('OpenAPI', () => {

    it('publishes DATE as a date and TIMESTAMP WITHOUT TIME ZONE as a plain string', async () => {
      const { paths } = await getJson(filby, '/openapi.json');
      const { properties } = paths['/projections/Openings/v1'].get.responses['200'].content['application/json'].schema.items;
      deq(properties.opens, { type: ['string', 'null'], format: 'date' });
      deq(properties.starts, { type: ['string', 'null'] });
      deq(properties.closures, { type: ['array', 'null'], items: { type: 'string', format: 'date' } });
      deq(properties.visits, { type: ['array', 'null'], items: { type: 'string' } });
      deq(properties.recorded, { type: ['string', 'null'], format: 'date-time' });
    });

    it("publishes the same schema under localDateTypes: 'pg'", async () => {
      deq(await getJson(pg, '/openapi.json'), await getJson(filby, '/openapi.json'));
    });
  });

  describe('Export', () => {

    let directory;

    before(() => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), 'filby-local-dates-'));
    });

    after(() => {
      fs.rmSync(directory, { recursive: true, force: true });
    });

    for (const zone of ZONES) {
      it(`writes text in ${zone} even when the configuration says 'pg'`, async () => {
        const configFile = path.join(directory, 'filby.json');
        fs.writeFileSync(configFile, JSON.stringify({ database: { user: 'fby_test', password: 'fby_test' }, migrations: [], localDateTypes: 'pg' }));
        for (const projection of ['Openings', 'Opening Rows']) {
          const out = path.join(directory, 'bundle.json');
          await run(process.execPath, [cli, 'export', '--config', configFile, '--projection', `${projection}@1`, '--out', out], { env: { ...process.env, TZ: zone } });
          const { documents } = JSON.parse(fs.readFileSync(out, 'utf8'));
          deq(documents[changeSetId], EXPECTED);
        }
      });
    }
  });
});

async function inZone(zone, fn) {
  const original = process.env.TZ;
  process.env.TZ = zone;
  try {
    return await fn();
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
}

async function getJson(filby, pathname) {
  const response = await filby.fetch(new Request(`http://localhost${pathname}`));
  eq(response.status, 200, await response.clone().text());
  return response.json();
}

function pick({ code, opens, starts, closures, visits, recorded }) {
  return { code, opens, starts, closures, visits, recorded };
}

function json(value) {
  return JSON.parse(JSON.stringify(value));
}
