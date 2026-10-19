const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { strictEqual: eq, deepEqual: deq, match, rejects } = require('node:assert');
const { describe, it, beforeEach, after } = require('node:test');
const marv = require('marv/api/promise');
const { Client } = require('pg');

const { Filby } = require('..');
const driver = require('../lib/marv-filby-driver');

const server = { user: 'fby_test', password: 'fby_test' };
const upgradeDatabase = `${process.env.PGDATABASE || 'fby_test'}_upgrade`;
const database = { ...server, database: upgradeDatabase };
const filbyDirectory = path.join(__dirname, '..', 'migrations');
const directories = [];

describe('Upgrade', () => {

  beforeEach(async () => {
    await execute(server, `DROP DATABASE IF EXISTS ${upgradeDatabase} WITH (FORCE)`);
    await execute(server, `CREATE DATABASE ${upgradeDatabase}`);
    await installFilby({ upToLevel: 8 });
  });

  after(async () => {
    await execute(server, `DROP DATABASE IF EXISTS ${upgradeDatabase} WITH (FORCE)`);
    await Promise.all(directories.map((directory) => fs.rm(directory, { recursive: true, force: true })));
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

  it('should regenerate aggregate functions', async () => {
    await createVatRateEntity();
    await query(`
      CREATE FUNCTION get_vat_rate_v1_aggregate(p_change_set_id INTEGER) RETURNS TABLE (
        tax_rate vat_tax_rate,
        region VARCHAR(20),
        rate NUMERIC
      )
      AS $$
      BEGIN
        RETURN QUERY
        WITH aggregated AS (
          SELECT
            DISTINCT ON (tax_rate, region)
            f.action AS fby_action,
            x.tax_rate,
            x.region,
            x.rate
          FROM
            fby_data_frame f
          INNER JOIN fby_entity e ON e.id = f.entity_id
          INNER JOIN vat_rate_v1 x ON x.fby_frame_id = f.id
          WHERE e.name = 'VAT Rate'
            AND e.version = '1'
            AND f.change_set_id <= p_change_set_id
          ORDER BY
            x.tax_rate ASC,
            x.region ASC,
            x.fby_frame_id DESC
        )
        SELECT
          a.tax_rate,
          a.region,
          a.rate
        FROM aggregated a
        WHERE a.fby_action <> 'DELETE';
      END;
      $$ LANGUAGE plpgsql;

      INSERT INTO fby_change_set (id, effective, description) VALUES
        (1, '2020-04-05T00:00:00.000Z', '2020 VAT Rates'),
        (2, '2022-04-05T00:00:00.000Z', '2022 VAT Rates'),
        (3, '2021-04-05T00:00:00.000Z', '2021 VAT Rates'),
        (4, '2023-04-05T00:00:00.000Z', '2023 VAT Rates');

      INSERT INTO fby_data_frame (id, change_set_id, entity_id, action) VALUES
        (1, 1, (SELECT id FROM fby_entity), 'POST'),
        (2, 2, (SELECT id FROM fby_entity), 'POST'),
        (3, 3, (SELECT id FROM fby_entity), 'POST'),
        (4, 4, (SELECT id FROM fby_entity), 'POST');

      INSERT INTO vat_rate_v1 (fby_frame_id, tax_rate, region, rate) VALUES
        (1, 'standard', 'uk', 0.175),
        (2, 'standard', 'uk', 0.20),
        (3, 'standard', 'uk', 0.18),
        (4, 'reduced', 'uk', 0.05);

      SELECT setval(pg_get_serial_sequence('fby_change_set', 'id'), 4);
      SELECT setval(pg_get_serial_sequence('fby_data_frame', 'id'), 4);
    `);

    await upgrade();

    const { rows: functions } = await query(`
      SELECT l.lanname AS language, p.provolatile AS volatility
      FROM pg_proc p
      INNER JOIN pg_language l ON l.oid = p.prolang
      WHERE p.proname = 'get_vat_rate_v1_aggregate'`);
    deq(functions, [{ language: 'sql', volatility: 's' }]);

    const { rows: aggregate2021 } = await query('SELECT * FROM get_vat_rate_v1_aggregate(3)');
    deq(aggregate2021, [{ tax_rate: 'standard', region: 'uk', rate: '0.18' }]);

    const { rows: aggregate2023 } = await query('SELECT * FROM get_vat_rate_v1_aggregate(4) ORDER BY rate DESC');
    deq(aggregate2023, [
      { tax_rate: 'standard', region: 'uk', rate: '0.20' },
      { tax_rate: 'reduced', region: 'uk', rate: '0.05' },
    ]);
  });

  it('should rename POST frames to SET', async () => {
    await createVatRateEntity();
    await query(`
      INSERT INTO fby_change_set (id, effective, description) VALUES
        (1, '2020-04-05T00:00:00.000Z', '2020 VAT Rates'),
        (2, '2021-04-05T00:00:00.000Z', '2021 VAT Rates');

      INSERT INTO fby_data_frame (id, change_set_id, entity_id, action) VALUES
        (1, 1, (SELECT id FROM fby_entity), 'POST'),
        (2, 1, (SELECT id FROM fby_entity), 'POST'),
        (3, 2, (SELECT id FROM fby_entity), 'DELETE');

      INSERT INTO vat_rate_v1 (fby_frame_id, tax_rate, region, rate) VALUES
        (1, 'standard', 'uk', 0.20),
        (2, 'reduced', 'uk', 0.05),
        (3, 'reduced', 'uk', NULL);
    `);

    await upgrade();

    const { rows: labels } = await query("SELECT enumlabel AS label FROM pg_enum WHERE enumtypid = 'fby_action_type'::regtype ORDER BY enumsortorder");
    deq(labels, [{ label: 'SET' }, { label: 'DELETE' }]);

    const { rows: frames } = await query('SELECT id, action FROM fby_data_frame ORDER BY id');
    deq(frames, [
      { id: 1, action: 'SET' },
      { id: 2, action: 'SET' },
      { id: 3, action: 'DELETE' },
    ]);

    const { rows: aggregate2020 } = await query('SELECT * FROM get_vat_rate_v1_aggregate(1) ORDER BY rate DESC');
    deq(aggregate2020, [
      { tax_rate: 'standard', region: 'uk', rate: '0.20' },
      { tax_rate: 'reduced', region: 'uk', rate: '0.05' },
    ]);

    const { rows: aggregate2021 } = await query('SELECT * FROM get_vat_rate_v1_aggregate(2)');
    deq(aggregate2021, [{ tax_rate: 'standard', region: 'uk', rate: '0.20' }]);
  });

  it('should backfill change set entities', async () => {
    await createVatRateEntity();
    await createVatRatesProjection();
    await addChangeSet({ effective: '2026-01-01', description: '2026 VAT Rates', taxRate: 'standard', rate: '0.2' });
    await addChangeSet({ effective: '2027-01-01', description: '2027 VAT Rates', taxRate: 'standard', rate: '0.25' });
    await addChangeSet({ effective: '2026-06-01', description: 'Mid 2026 VAT Rates', taxRate: 'reduced', rate: '0.05' });

    await upgrade();

    const { rows } = await query('SELECT change_set_id FROM fby_change_set_entity ORDER BY change_set_id');
    deq(rows, [{ change_set_id: 1 }, { change_set_id: 2 }, { change_set_id: 3 }, { change_set_id: 4 }]);
  });

  it('should re-issue change sets with a later effective date than a later change set', async () => {
    await createVatRateEntity();
    await createVatRatesProjection();
    await addChangeSet({ effective: '2026-01-01', description: '2026 VAT Rates', taxRate: 'standard', rate: '0.2' });
    await addChangeSet({ effective: '2027-01-01', description: '2027 VAT Rates', taxRate: 'standard', rate: '0.25' });
    await addChangeSet({ effective: '2026-06-01', description: 'Mid 2026 VAT Rates', taxRate: 'reduced', rate: '0.05' });

    await upgrade();

    const { rows: changeSets } = await query('SELECT id, description, superseded_by, reissued_from FROM fby_change_set ORDER BY id');
    deq(changeSets, [
      { id: 1, description: '2026 VAT Rates', superseded_by: null, reissued_from: null },
      { id: 2, description: '2027 VAT Rates', superseded_by: 4, reissued_from: null },
      { id: 3, description: 'Mid 2026 VAT Rates', superseded_by: null, reissued_from: null },
      { id: 4, description: '2027 VAT Rates', superseded_by: null, reissued_from: 2 },
    ]);

    const { rows: reissuedAggregate } = await query('SELECT * FROM get_vat_rate_v1_aggregate(4) ORDER BY rate DESC');
    deq(reissuedAggregate, [
      { tax_rate: 'standard', region: 'uk', rate: '0.25' },
      { tax_rate: 'reduced', region: 'uk', rate: '0.05' },
    ]);

    const { rows: originalAggregate } = await query('SELECT * FROM get_vat_rate_v1_aggregate(2)');
    deq(originalAggregate, [{ tax_rate: 'standard', region: 'uk', rate: '0.25' }]);

    const { rows: notifications } = await query(`
      SELECT h.name AS hook_name, n.projection_name, n.projection_version
      FROM fby_notification n
      INNER JOIN fby_hook h ON h.id = n.hook_id`);
    deq(notifications, [{ hook_name: 'sns/add-change-set/vat-rates-v1', projection_name: 'VAT Rates', projection_version: 1 }]);
  });

  it('should re-issue change sets as adding them in a migration would', async () => {
    await expectSameLiveChangeSetsAsMigration([
      { effective: '2026-01-01', description: '2026 VAT Rates', taxRate: 'standard', rate: '0.2' },
      { effective: '2027-01-01', description: '2027 VAT Rates', taxRate: 'standard', rate: '0.25' },
      { effective: '2026-06-01', description: 'Mid 2026 VAT Rates', taxRate: 'reduced', rate: '0.05' },
    ]);
  });

  it('should re-issue change sets with a later effective date than a re-issued change set', async () => {
    const liveChangeSets = await expectSameLiveChangeSetsAsMigration([
      { effective: '2020-01-01', description: '2020 VAT Rates', taxRate: 'standard', rate: '0.2' },
      { effective: '2025-01-01', description: '2025 VAT Rates', taxRate: 'standard', rate: '0.25' },
      { effective: '2021-01-01', description: '2021 VAT Rates', taxRate: 'reduced', rate: '0.05' },
      { effective: '2030-01-01', description: '2030 VAT Rates', taxRate: 'zero', rate: '0' },
    ]);
    deq(
      liveChangeSets.map(({ description }) => description),
      ['2020 VAT Rates', '2021 VAT Rates', '2025 VAT Rates', '2030 VAT Rates'],
    );
  });

  it('should not re-issue change sets that are already in order', async () => {
    await createVatRateEntity();
    await createVatRatesProjection();
    await addChangeSet({ effective: '2020-01-01', description: '2020 VAT Rates', taxRate: 'standard', rate: '0.2' });
    await addChangeSet({ effective: '2021-01-01', description: '2021 VAT Rates', taxRate: 'reduced', rate: '0.05' });
    await addChangeSet({ effective: '2021-01-01', description: '2021 VAT Rates Correction', taxRate: 'reduced', rate: '0.06' });

    await upgrade();

    const { rows: changeSets } = await query('SELECT id, description, superseded_by, reissued_from FROM fby_change_set ORDER BY id');
    deq(changeSets, [
      { id: 1, description: '2020 VAT Rates', superseded_by: null, reissued_from: null },
      { id: 2, description: '2021 VAT Rates', superseded_by: null, reissued_from: null },
      { id: 3, description: '2021 VAT Rates Correction', superseded_by: null, reissued_from: null },
    ]);

    const { rows: frames } = await query('SELECT id, change_set_id FROM fby_data_frame ORDER BY id');
    deq(frames, [
      { id: 1, change_set_id: 1 },
      { id: 2, change_set_id: 2 },
      { id: 3, change_set_id: 3 },
    ]);

    const { rows: notifications } = await query('SELECT id FROM fby_notification');
    deq(notifications, []);
  });

  it('should upgrade databases created with pgcrypto', async () => {
    await query(`
      CREATE EXTENSION pgcrypto;
      ALTER TABLE fby_change_set ALTER COLUMN entity_tag SET DEFAULT encode(gen_random_bytes(10), 'hex');
      UPDATE migrations SET checksum = '77caf46a2363da07bdc85fd33238dc8b' WHERE namespace = 'filby' AND level = 6;
      INSERT INTO fby_change_set (id, effective, description) VALUES (1, '2020-04-05T00:00:00.000Z', '2020 VAT Rates');
    `);
    const { rows: [{ entity_tag: before }] } = await query('SELECT entity_tag FROM fby_change_set WHERE id = 1');

    await upgrade();

    await query('DROP EXTENSION pgcrypto');
    await query("INSERT INTO fby_change_set (id, effective, description) VALUES (2, '2021-04-05T00:00:00.000Z', '2021 VAT Rates')");
    const { rows: changeSets } = await query('SELECT id, entity_tag FROM fby_change_set ORDER BY id');
    eq(changeSets[0].entity_tag, before);
    match(changeSets[1].entity_tag, /^[a-f0-9]{20}$/);
  });

  it('should install into databases that already have pgcrypto', async () => {
    await execute(server, `DROP DATABASE ${upgradeDatabase} WITH (FORCE)`);
    await execute(server, `CREATE DATABASE ${upgradeDatabase}`);
    await query('CREATE EXTENSION pgcrypto');

    await upgrade();

    await query("INSERT INTO fby_change_set (id, effective, description) VALUES (1, '2020-04-05T00:00:00.000Z', '2020 VAT Rates')");
    const { rows: [{ entity_tag: entityTag }] } = await query('SELECT entity_tag FROM fby_change_set WHERE id = 1');
    match(entityTag, /^[a-f0-9]{20}$/);
  });

  async function expectSameLiveChangeSetsAsMigration(changeSets) {
    await createVatRateEntity();
    await createVatRatesProjection();
    for (const changeSet of changeSets) {
      await addChangeSet(changeSet);
    }
    await upgrade();
    const upgraded = await getLiveChangeSets();

    await execute(server, `DROP DATABASE ${upgradeDatabase} WITH (FORCE)`);
    await execute(server, `CREATE DATABASE ${upgradeDatabase}`);
    await applyYaml(vatRatesMigration(changeSets));
    const migrated = await getLiveChangeSets();

    deq(upgraded, migrated);
    return upgraded;
  }

  async function getLiveChangeSets() {
    const { rows: changeSets } = await query('SELECT id, description, effective FROM fby_change_set WHERE superseded_by IS NULL ORDER BY id');
    return Promise.all(
      changeSets.map(async ({ id, description, effective }) => {
        const { rows: aggregate } = await query(`SELECT tax_rate::TEXT, region::TEXT, rate FROM get_vat_rate_v1_aggregate(${id}) ORDER BY rate DESC`);
        return { description, effective: effective.toISOString(), aggregate };
      }),
    );
  }

  async function applyYaml(yaml) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'filby-'));
    directories.push(directory);
    await fs.writeFile(path.join(directory, '.marvrc'), JSON.stringify({ directives: { audit: false } }));
    await fs.writeFile(path.join(directory, '001.vat-rates.yaml'), yaml);
    await upgrade([directory]);
  }

  function vatRatesMigration(changeSets) {
    return `
- operation: ADD_ENTITY
  name: VAT Rate
  version: 1
  fields:
    - name: tax_rate
      type: TEXT
    - name: region
      type: TEXT
    - name: rate
      type: NUMERIC
  identified_by:
    - tax_rate
    - region
- operation: ADD_PROJECTION
  name: VAT Rates
  version: 1
  dependencies:
    - entity: VAT Rate
      version: 1
- operation: ADD_HOOK
  name: sns/add-change-set/vat-rates-v1
  event: ADD_CHANGE_SET
  projection: VAT Rates
  version: 1
${changeSets.map(({ effective, description, taxRate, rate }) => `
- operation: ADD_CHANGE_SET
  description: ${description}
  effective: ${effective}T00:00:00.000Z
  frames:
    - entity: VAT Rate
      version: 1
      action: SET
      data:
        - tax_rate: ${taxRate}
          region: uk
          rate: ${rate}`).join('')}`;
  }

  async function createVatRatesProjection() {
    await query(`
      INSERT INTO fby_projection (name, version) VALUES ('VAT Rates', 1);
      INSERT INTO fby_projection_entity (projection_id, entity_id) SELECT p.id, e.id FROM fby_projection p, fby_entity e;
      INSERT INTO fby_hook (name, event, projection_id) SELECT 'sns/add-change-set/vat-rates-v1', 'ADD_CHANGE_SET', id FROM fby_projection;
    `);
  }

  async function addChangeSet({ effective, description, taxRate, rate }) {
    await query(`
      WITH change_set AS (
        INSERT INTO fby_change_set (effective, description) VALUES ('${effective}T00:00:00.000Z', '${description}') RETURNING id
      ), frame AS (
        INSERT INTO fby_data_frame (change_set_id, entity_id, action) SELECT change_set.id, fby_entity.id, 'POST' FROM change_set, fby_entity RETURNING id
      )
      INSERT INTO vat_rate_v1 (fby_frame_id, tax_rate, region, rate) SELECT frame.id, '${taxRate}', 'uk', ${rate} FROM frame;
    `);
  }

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

  async function upgrade(migrations = []) {
    const filby = new Filby({ database, migrations });
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
