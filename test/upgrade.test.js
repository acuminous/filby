const { deepEqual: deq } = require('node:assert');
const { describe, it, before, beforeEach, after } = require('node:test');

const { Filby } = require('..');
const TestFilby = require('./TestFilby');

const database = { user: 'fby_test', password: 'fby_test' };

const config = {
  database,
  nukeCustomObjects: async (tx) => {
    await tx.query('DROP TABLE IF EXISTS vat_rate_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_vat_rate_v1_aggregate');
    await tx.query('DROP TYPE IF EXISTS vat_tax_rate');
  },
};

describe('Upgrade', () => {

  let filby;

  before(async () => {
    filby = new TestFilby(config);
    await filby.reset();
  });

  beforeEach(async () => {
    await filby.wipe();
  });

  after(async () => {
    await filby.stop();
  });

  it('should backfill entity metadata', async (t) => {
    await filby.applyYaml(
      t.name,
      '- operation: ADD_ENUM',
      '  name: VAT Tax Rate',
      '  values:',
      '    - standard',
      '    - reduced',
      '    - zero',
      '- operation: ADD_ENTITY',
      '  name: VAT Rate',
      '  version: 1',
      '  fields:',
      '    - name: Tax Rate',
      '      type: vat_tax_rate',
      '    - name: region',
      '      type: VARCHAR(20)',
      '    - name: rate',
      '      type: NUMERIC',
      '  identified_by:',
      '    - Tax Rate',
      '    - region',
      '  checks:',
      '    max_rate: (rate <= 1)',
    );
    await query('DELETE FROM fby_entity_field');
    await query('DELETE FROM fby_entity_check');
    await query('DELETE FROM fby_enum');

    await rerunFilbyMigration(10);

    const { rows: fields } = await query('SELECT position, name, type, identity FROM fby_entity_field ORDER BY position');
    deq(fields, [
      { position: 1, name: 'tax_rate', type: 'vat_tax_rate', identity: true },
      { position: 2, name: 'region', type: 'character varying(20)', identity: true },
      { position: 3, name: 'rate', type: 'numeric', identity: false },
    ]);

    const { rows: checks } = await query('SELECT name, expression FROM fby_entity_check');
    deq(checks, [{ name: 'max_rate', expression: '((rate <= (1)::numeric))' }]);

    const { rows: values } = await query('SELECT name, position, value FROM fby_enum ORDER BY position');
    deq(values, [
      { name: 'vat_tax_rate', position: 1, value: 'standard' },
      { name: 'vat_tax_rate', position: 2, value: 'reduced' },
      { name: 'vat_tax_rate', position: 3, value: 'zero' },
    ]);
  });

  async function rerunFilbyMigration(level) {
    await query("DELETE FROM migrations WHERE namespace = 'filby' AND level = $1", [level]);
    const instance = new Filby({ database, migrations: [] });
    try {
      await instance.init();
    } finally {
      await instance.stop();
    }
  }

  async function query(sql, params) {
    return filby.withTransaction((tx) => tx.query(sql, params));
  }
});
