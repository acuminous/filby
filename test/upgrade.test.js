const path = require('node:path');
const { deepEqual: deq } = require('node:assert');
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
