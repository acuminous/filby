const fs = require('node:fs');
const path = require('node:path');
const { ok, strictEqual: eq, deepEqual: deq, rejects, match } = require('node:assert');
const { describe, it, before, beforeEach, after, afterEach } = require('zunit');

const TestReferenceDataFramework = require('./TestReferenceDataFramework');

const config = {
  migrations: 'test/dsl',
  database: {
    user: 'rdf_test',
    password: 'rdf_test'
  },
  notifications: {
    initialDelay: '0ms',
    interval: '100ms',
    maxAttempts: 3,
    maxRescheduleDelay: '100ms',
  },
  nukeCustomObjects: async (tx) => {
    await tx.query('DROP TABLE IF EXISTS vat_rate_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_vat_rate_v1_aggregate');
    await tx.query('DROP TABLE IF EXISTS vat_rate_v2');
    await tx.query('DROP FUNCTION IF EXISTS get_vat_rate_v2_aggregate');
    await tx.query('DROP TABLE IF EXISTS cgt_rate_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_cgt_rate_v1_aggregate');
  }
}

describe('DSL', () => {

  let rdf;

  before(async () => {
    deleteMigrations();
    rdf = new TestReferenceDataFramework(config);
    await rdf.reset();
  })

  beforeEach(async () => {
    deleteMigrations();
    await rdf.wipe();
  })

  after(async () => {
    await rdf.stop();
  })

  describe('Projections', () => {
    it('should add projections', async (t) => {
      await apply(t.name, `
        define entities:
        - name: VAT Rate
          version: 1
          fields:
          - name: type
            type: TEXT
          - name: rate
            type: NUMERIC
          identified by:
          - type

        add projections:
        - name: VAT Rates
          version: 1
          dependencies:
          - entity: VAT Rate
            version: 1
        `);
      const { rows: projections } = await rdf.withTransaction((tx) => {
        return tx.query('SELECT name, version FROM rdf_projection');
      });

      eq(projections.length, 1);
      deq(projections[0], { name: 'VAT Rates', version: 1 });
    });
  });

  describe('Entities', () => {
    it('should add entities', async (t) => {
      await apply(t.name, `
        define entities:
        - name: VAT Rate
          version: 1
          fields:
          - name: type
            type: TEXT
          - name: rate
            type: NUMERIC
          identified by:
          - type
      `);

      const { rows: entities } = await rdf.withTransaction((tx) => {
        return tx.query('SELECT name, version FROM rdf_entity');
      });

      eq(entities.length, 1);
      deq(entities[0], { name: 'VAT Rate', version: 1 });
    });

    it('should aggregate data frames up to the specified change set', async (t) => {
      await apply(t.name, `
        add projections:
        - name: VAT Rates
          version: 1
          dependencies:
          - entity: VAT Rate
            version: 1

        define entities:
        - name: VAT Rate
          version: 1
          fields:
          - name: type
            type: TEXT
          - name: rate
            type: NUMERIC
          identified by:
          - type

        add change set:
        - notes: 2020 VAT Rates
          effective from: 2020-04-05T00:00:00.000Z
          frames:
          - entity: VAT Rate
            version: 1
            action: POST
            data:
            - type: standard
              rate: 0.10
          - entity: VAT Rate
            version: 1
            action: POST
            data:
            - type: reduced
              rate: 0.05
          - entity: VAT Rate
            version: 1
            action: POST
            data:
            - type: zero
              rate: 0

        - notes: 2021 VAT Rates
          effective from: 2021-04-05T00:00:00.000Z
          frames:
          - entity: VAT Rate
            version: 1
            action: POST
            data:
            - type: standard
              rate: 0.125
          - entity: VAT Rate
            version: 1
            action: POST
            data:
            - type: reduced
              rate: 0.07
          - entity: VAT Rate
            version: 1
            action: POST
            data:
            - type: zero
              rate: 0

        - notes: 2022 VAT Rates
          effective from: 2022-04-05T00:00:00.000Z
          frames:
          - entity: VAT Rate
            version: 1
            action: POST
            data:
            - type: standard
              rate: 0.15
          - entity: VAT Rate
            version: 1
            action: POST
            data:
            - type: reduced
              rate: 0.10
          - entity: VAT Rate
            version: 1
            action: POST
            data:
            - type: zero
              rate: 0
      `);

      const projection = await rdf.getProjection('VAT Rates', 1);
      const changeLog = await rdf.getChangeLog(projection);

      await rdf.withTransaction(async (tx) => {
        const { rows: aggregate1 } = await tx.query('SELECT * FROM get_vat_rate_v1_aggregate($1) ORDER BY rate DESC', [changeLog[0].id]);
        eq(aggregate1.length, 3);
        deq(aggregate1[0], { type: 'standard', rate: 0.10 });
        deq(aggregate1[1], { type: 'reduced', rate: 0.05 });
        deq(aggregate1[2], { type: 'zero', rate: 0 });

        const { rows: aggregate3 } = await tx.query('SELECT * FROM get_vat_rate_v1_aggregate($1) ORDER BY rate DESC NULLS LAST', [changeLog[2].id]);
        eq(aggregate3.length, 3);
        deq(aggregate3[0], { type: 'standard', rate: 0.15 });
        deq(aggregate3[1], { type: 'reduced', rate: 0.10 });
        deq(aggregate1[2], { type: 'zero', rate: 0 });
      })
    });

    it('should exclude aggregates where the most recent frame was a delete', async (t) => {
      await apply(t.name, `
        add projections:
        - name: VAT Rates
          version: 1
          dependencies:
          - entity: VAT Rate
            version: 1

        define entities:
        - name: VAT Rate
          version: 1
          fields:
          - name: type
            type: TEXT
          - name: rate
            type: NUMERIC
          identified by:
          - type

        add change set:
        - notes: 2020 VAT Rates
          effective from: 2020-04-05T00:00:00.000Z
          frames:
          - entity: VAT Rate
            version: 1
            action: POST
            data:
            - type: standard
              rate: 0.10
          - entity: VAT Rate
            version: 1
            action: POST
            data:
            - type: reduced
              rate: 0.05
          - entity: VAT Rate
            version: 1
            action: POST
            data:
            - type: zero
              rate: 0

        - notes: 2021 VAT Rates
          effective from: 2021-04-05T00:00:00.000Z
          frames:
          - entity: VAT Rate
            version: 1
            action: POST
            data:
            - type: standard
              rate: 0.125
          - entity: VAT Rate
            version: 1
            action: POST
            data:
            - type: reduced
              rate: 0.07
          - entity: VAT Rate
            version: 1
            action: POST
            data:
            - type: zero
              rate: 0

        - notes: 2022 VAT Rates
          effective from: 2022-04-05T00:00:00.000Z
          frames:
          - entity: VAT Rate
            version: 1
            action: POST
            data:
            - type: standard
              rate: 0.15
          - entity: VAT Rate
            version: 1
            action: POST
            data:
            - type: reduced
              rate: 0.10
          - entity: VAT Rate
            version: 1
            action: DELETE
            data:
            - type: zero
      `);

      const projection = await rdf.getProjection('VAT Rates', 1);
      const changeLog = await rdf.getChangeLog(projection);

      await rdf.withTransaction(async (tx) => {
        const { rows: aggregate1 } = await tx.query('SELECT * FROM get_vat_rate_v1_aggregate($1) ORDER BY rate DESC', [changeLog[0].id]);
        eq(aggregate1.length, 3);
        deq(aggregate1[0], { type: 'standard', rate: 0.10 });
        deq(aggregate1[1], { type: 'reduced', rate: 0.05 });
        deq(aggregate1[2], { type: 'zero', rate: 0 });

        const { rows: aggregate3 } = await tx.query('SELECT * FROM get_vat_rate_v1_aggregate($1) ORDER BY rate DESC NULLS LAST', [changeLog[2].id]);
        eq(aggregate3.length, 2);
        deq(aggregate3[0], { type: 'standard', rate: 0.15 });
        deq(aggregate3[1], { type: 'reduced', rate: 0.10 });
      });
    });
  });

  describe('Hooks', () => {
    it('should add hooks', async (t) => {
      await apply(t.name, `
        define entities:
        - name: VAT Rate
          version: 1
          fields:
          - name: type
            type: TEXT
          - name: rate
            type: NUMERIC
          identified by:
          - type

        add projections:
        - name: VAT Rates
          version: 1
          dependencies:
          - entity: VAT Rate
            version: 1

        add hooks:
        - projection: VAT Rates
          version: 1
          event: VAT Rates Change
        - event: Any Change
      `);

      const { rows: hooks } = await rdf.withTransaction((tx) => {
        return tx.query('SELECT name, version, event FROM rdf_hook h LEFT JOIN rdf_projection p ON h.projection_id = p.id');
      });

      eq(hooks.length, 2);
      deq(hooks[0], { name: 'VAT Rates', version: 1, event: 'VAT Rates Change' });
      deq(hooks[1], { name: null, version: null, event: 'Any Change' });
    });
  });

  async function apply(name, script) {
    fs.writeFileSync(path.join(__dirname, 'dsl', `001.${name.replace(/ /g, '-')}.yaml`), script, { encoding: 'utf-8' });
    await rdf.init();
  }

  function deleteMigrations() {
    fs.readdirSync(path.join(__dirname, 'dsl'))
      .filter(file => path.extname(file).toLowerCase() === '.yaml')
      .map(file => path.join(__dirname, 'dsl', file))
      .forEach(file => fs.unlinkSync(file));
  }

});