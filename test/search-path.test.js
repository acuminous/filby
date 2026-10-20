const fs = require('node:fs');
const path = require('node:path');
const { strictEqual: eq, deepEqual: deq } = require('node:assert');
const { describe, it, before, beforeEach, after, afterEach } = require('node:test');

const TestFilby = require('./TestFilby');
const { once } = require('./until');

const SCHEMA = 'filby_test_schema';

const config = {
  schema: SCHEMA,
  notifications: {
    initialDelay: '0ms',
    interval: '100ms',
    maxAttempts: 3,
    maxRescheduleDelay: '100ms',
  },
  nukeCustomObjects: async (tx) => {
    await tx.query('DROP FUNCTION IF EXISTS get_vat_rates_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_vat_rate_v1_aggregate');
    await tx.query('DROP TABLE IF EXISTS vat_rate_v1');
  },
};

describe('Search Path', () => {

  let filby;
  let publicTables;

  before(async () => {
    filby = new TestFilby(config);
    await dropSchema();
    publicTables = await getTables('public');
    await filby.reset();
  });

  beforeEach(async () => {
    filby.unsubscribeAll();
    await filby.wipe();
  });

  afterEach(async () => {
    filby.unsubscribeAll();
    await filby.stopNotifications();
  });

  after(async () => {
    await dropSchema();
    await filby.stop();
  });

  async function dropSchema() {
    await filby.withTransaction((tx) => tx.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`));
  }

  async function getTables(schema) {
    const { rows } = await filby.withTransaction((tx) => tx.query('SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name', [schema]));
    return rows.map((row) => row.table_name);
  }

  it('should create Filby, marv and entity tables in the configured schema and leave public untouched', async (t) => {
    await filby.applyYaml(t.name, loadYaml('ADD_ENTITY'), loadYaml('ADD_CHANGE_SET_1'));

    const tables = await getTables(SCHEMA);
    for (const table of ['migrations', 'fby_entity', 'vat_rate_v1']) eq(tables.includes(table), true, `${table} not in ${SCHEMA}`);
    deq(await getTables('public'), publicTables);
    eq(filby.config.database.options, undefined);
  });

  it('should serve projections, change sets and documents from the configured schema', async (t) => {
    await filby.applyYaml(t.name, loadYaml('ADD_ENTITY'), loadYaml('ADD_ROOT_PROJECTION'), loadYaml('ADD_CHANGE_SET_1'));

    const projections = await filby.getProjections();
    eq(projections.length, 1);
    eq(projections[0].key, 'VAT Rates v1');

    const changeSet = await filby.getCurrentChangeSet(projections[0]);
    eq(changeSet.description, '2020 VAT Rates');

    const { documents, total } = await filby.getDocuments(projections[0], changeSet.id, { pageSize: 3 });
    eq(total, 3);
    deq(documents.map(({ type, rate }) => ({ type, rate })), [
      { type: 'zero', rate: '0' },
      { type: 'reduced', rate: '0.05' },
      { type: 'standard', rate: '0.1' },
    ]);
  });

  it('should deliver hook notifications from the configured schema', async (t) => {
    await filby.applyYaml(t.name, loadYaml('ADD_ENTITY'), loadYaml('ADD_PROJECTION'), loadYaml('ADD_HOOK_CHANGE_SET_PROJECTION'), loadYaml('ADD_CHANGE_SET_1'));

    const delivered = once(filby, 'sns/add-change-set/vat-rates-v1');
    await filby.startNotifications();
    const notification = await delivered;

    eq(notification.projection.key, 'VAT Rates v1');
  });

  it('should listen for notifications in the configured schema', async (t) => {
    const other = new TestFilby({ ...config, notifications: { initialDelay: '1h', interval: '1h', listen: true } });
    try {
      await other.startNotifications();

      const delivered = once(other, 'sns/add-change-set/vat-rates-v1', { timeout: 1000 });
      await filby.applyYaml(t.name, loadYaml('ADD_ENTITY'), loadYaml('ADD_PROJECTION'), loadYaml('ADD_HOOK_CHANGE_SET_PROJECTION'), loadYaml('ADD_CHANGE_SET_1'));
      const notification = await delivered;

      eq(notification.projection.key, 'VAT Rates v1');
    } finally {
      await other.stop();
    }
  });
});

function loadYaml(filename) {
  return fs.readFileSync(path.join(__dirname, 'dsl', 'snippets', `${filename}.yaml`), { encoding: 'utf-8' });
}
