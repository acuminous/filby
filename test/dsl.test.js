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
  },
  wipeCustomData: async (tx) => {
    await tx.query('DELETE FROM vat_rate_v1');
    await tx.query('DELETE FROM vat_rate_v2');
    await tx.query('DELETE FROM cgt_rate_v1');
  }
}

describe('DSL', () => {

  let rdf;

  before(async () => {
    rdf = new TestReferenceDataFramework(config);
    await rdf.reset();
  })

  beforeEach(async () => {
    deleteMigrations();
    await rdf.reset();
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
          identified by: [
            type
          ]
        `);

      const { rows: entities } = await rdf.withTransaction((tx) => {
        return tx.query('SELECT name, version FROM rdf_entity');
      });

      eq(entities.length, 1);
      deq(entities[0], { name: 'VAT Rate', version: 1 });
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
