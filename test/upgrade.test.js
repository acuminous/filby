const path = require('node:path');
const { strictEqual: eq, deepEqual: deq, rejects } = require('node:assert');
const { describe, it, beforeEach, after } = require('node:test');
const marv = require('marv/api/promise');
const { Client } = require('pg');

const { Filby } = require('..');
const driver = require('../lib/marv-filby-driver');

const server = { user: 'fby_test', password: 'fby_test' };
const database = { ...server, database: 'fby_upgrade' };
const filbyDirectory = path.join(__dirname, '..', 'migrations');

describe('Upgrade', () => {

  beforeEach(async () => {
    await execute(server, 'DROP DATABASE IF EXISTS fby_upgrade WITH (FORCE)');
    await execute(server, 'CREATE DATABASE fby_upgrade');
    await installFilby({ upToLevel: 8 });
  });

  after(async () => {
    await execute(server, 'DROP DATABASE IF EXISTS fby_upgrade WITH (FORCE)');
  });

  it('should backfill entity metadata', async () => {
    await createVatRateEntity();

    await upgrade();

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

  it('should upgrade entity tables to one frame per key per change set', async () => {
    await createVatRateEntity();
    await query(`
      INSERT INTO fby_change_set (id, effective, description) VALUES
        (1, '2020-04-05T00:00:00.000Z', '2020 VAT Rates'),
        (2, '2021-04-05T00:00:00.000Z', '2021 VAT Rates');

      INSERT INTO fby_data_frame (id, change_set_id, entity_id, action) VALUES
        (1, 1, (SELECT id FROM fby_entity), 'POST'),
        (2, 1, (SELECT id FROM fby_entity), 'POST'),
        (3, 2, (SELECT id FROM fby_entity), 'POST'),
        (4, 2, (SELECT id FROM fby_entity), 'POST');

      INSERT INTO vat_rate_v1 (fby_frame_id, tax_rate, region, rate) VALUES
        (1, 'standard', 'uk', 0.175),
        (2, 'reduced', 'uk', 0.05),
        (3, 'standard', 'uk', 0.20),
        (4, 'standard', 'uk', 0.21);
    `);

    await rejects(() => upgrade(), (err) => {
      eq(err.message, "Entity 'VAT Rate v1' has more than one frame with key (tax_rate=standard, region=uk) in change set '2021 VAT Rates'");
      eq(err.hint, 'Keep one frame per key in each change set. See the CHANGELOG for a query that lists every duplicate.');
      return true;
    });

    await query('DELETE FROM vat_rate_v1 WHERE fby_frame_id = 3; DELETE FROM fby_data_frame WHERE id = 3');

    await upgrade();

    const { rows: frames } = await query('SELECT fby_frame_id, fby_change_set_id FROM vat_rate_v1 ORDER BY fby_frame_id');
    deq(frames, [
      { fby_frame_id: 1, fby_change_set_id: 1 },
      { fby_frame_id: 2, fby_change_set_id: 1 },
      { fby_frame_id: 4, fby_change_set_id: 2 },
    ]);

    const { rows: constraints } = await query(`
      SELECT c.contype AS type, array_agg(a.attname::TEXT ORDER BY k.ordinality) AS columns, c.confdeltype AS on_delete
      FROM pg_constraint c
      CROSS JOIN unnest(c.conkey) WITH ORDINALITY k (attnum, ordinality)
      INNER JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      WHERE c.conrelid = 'vat_rate_v1'::regclass
        AND c.contype IN ('u', 'f')
      GROUP BY c.oid, c.contype, c.confdeltype
      ORDER BY c.contype`);
    deq(constraints, [
      { type: 'f', columns: ['fby_frame_id', 'fby_change_set_id'], on_delete: 'c' },
      { type: 'u', columns: ['fby_change_set_id', 'tax_rate', 'region'], on_delete: ' ' },
    ]);

    const { rows: columns } = await query(`
      SELECT attname AS name, attnotnull AS not_null
      FROM pg_attribute
      WHERE attrelid = 'vat_rate_v1'::regclass AND attnum > 0
      ORDER BY attnum`);
    deq(columns, [
      { name: 'fby_frame_id', not_null: true },
      { name: 'tax_rate', not_null: true },
      { name: 'region', not_null: true },
      { name: 'rate', not_null: false },
      { name: 'fby_change_set_id', not_null: true },
    ]);
  });

  async function createVatRateEntity() {
    await query(`
      CREATE TYPE vat_tax_rate AS ENUM ('standard', 'reduced', 'zero');

      INSERT INTO fby_entity (name, version) VALUES ('VAT Rate', 1);

      CREATE TABLE vat_rate_v1 (
        fby_frame_id INTEGER PRIMARY KEY REFERENCES fby_data_frame (id),
        tax_rate vat_tax_rate,
        region VARCHAR(20),
        rate NUMERIC,
        CONSTRAINT uniq_vat_rate_v1_fby_frame_id_tax_rate_region UNIQUE (fby_frame_id, tax_rate, region),
        CONSTRAINT chk_max_rate CHECK (rate <= 1)
      );
    `);
  }

  async function installFilby({ upToLevel }) {
    const migrations = await marv.scan(filbyDirectory);
    const released = migrations.filter(({ level }) => level <= upToLevel).map((migration) => ({ ...migration, directory: filbyDirectory }));
    await marv.migrate(released, driver({ database }), { checksums: 'error' });
  }

  async function upgrade() {
    const filby = new Filby({ database, migrations: [] });
    try {
      await filby.init();
    } finally {
      await filby.stop();
    }
  }

  async function query(sql) {
    return execute(database, sql);
  }
});

async function execute(config, sql) {
  const client = new Client(config);
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}
