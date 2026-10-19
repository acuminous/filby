const fs = require('node:fs/promises');
const path = require('node:path');
const { ok, strictEqual: eq } = require('node:assert');
const { describe, it, before, beforeEach, after, afterEach } = require('node:test');
const { Client } = require('pg');

const TestFilby = require('./TestFilby');
const { until } = require('./until');

const config = {
  notifications: {
    initialDelay: '0ms',
    interval: '100ms',
    maxAttempts: 3,
    maxRescheduleDelay: '100ms',
  },
  nukeCustomObjects: async (tx) => {
    await tx.query('DROP TABLE IF EXISTS vat_rate_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_vat_rate_v1_aggregate');
  },
};

const VAT_RATES = `
- operation: ADD_ENTITY
  name: VAT Rate
  version: 1
  fields:
    - name: type
      type: TEXT
    - name: rate
      type: NUMERIC
  identified_by:
    - type
- operation: ADD_PROJECTION
  name: VAT Rates
  version: 1
  dependencies:
    - entity: VAT Rate
      version: 1
`;

const ADD_VAT_RATES = `
- operation: ADD_HOOK
  name: VAT Rates Changed
  event: ADD_CHANGE_SET
  projection: VAT Rates
  version: 1
`;

describe('Migration Lock', () => {

  let filby;

  before(async () => {
    filby = new TestFilby(config);
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
    await filby.stop();
  });

  async function getNotifications(hookName) {
    const { rows } = await filby.withTransaction((tx) => tx.query(`
      SELECT n.*
      FROM fby_notification n
      INNER JOIN fby_hook h ON h.id = n.hook_id
      WHERE h.name = $1
      ORDER BY n.id`, [hookName]));
    return rows;
  }

  async function getLastSuccessfulPollAt() {
    const { lastSuccessfulPollAt } = await filby.getNotificationStatus();
    return lastSuccessfulPollAt?.getTime() ?? 0;
  }

  async function countWaitingAdvisoryLocks() {
    const { rows: [{ count }] } = await filby.withTransaction((tx) => tx.query(`
      SELECT COUNT(*)::INTEGER AS count
      FROM pg_locks
      WHERE locktype = 'advisory'
      AND NOT granted
      AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`));
    return count;
  }

  it('should not deliver notifications while a migration holds the lock', async (t) => {
    await filby.applyYaml(t.name, VAT_RATES, ADD_VAT_RATES, changeSet('2020 VAT Rates', '2020-04-05T00:00:00.000Z'));

    let deliveries = 0;
    filby.subscribe('VAT Rates Changed', () => {
      deliveries++;
    });

    const client = new Client(filby.config.database);
    await client.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [TestFilby.MIGRATION_LOCK_KEY]);
      const lockedAt = Date.now();

      filby.startNotifications();
      await until(async () => (await getLastSuccessfulPollAt()) > lockedAt);
      const firstTickAt = await getLastSuccessfulPollAt();
      await until(async () => (await getLastSuccessfulPollAt()) > firstTickAt);

      eq(deliveries, 0);
      const [notification] = await getNotifications('VAT Rates Changed');
      eq(notification.status, 'PENDING');
      eq(notification.attempts, 0);
      eq(notification.last_attempted, null);

      await client.query('SELECT pg_advisory_unlock($1)', [TestFilby.MIGRATION_LOCK_KEY]);
    } finally {
      await client.end();
    }

    await until(async () => (await getNotifications('VAT Rates Changed'))[0].status === 'OK');
    eq(deliveries, 1);
  });

  it('should wait for an in-flight delivery before migrating and then schedule a fresh notification', async () => {
    await filby.applyYaml('setup', VAT_RATES, ADD_VAT_RATES, changeSet('2020 VAT Rates', '2020-04-05T00:00:00.000Z'));

    let deliveries = 0;
    let completeDelivery;
    const inFlight = new Promise((resolve) => {
      completeDelivery = resolve;
    });
    filby.subscribe('VAT Rates Changed', () => {
      deliveries++;
      return deliveries === 1 ? inFlight : new Promise(() => {});
    });

    filby.startNotifications();
    await until(() => deliveries === 1);

    await fs.unlink(path.join(path.resolve(filby.config.migrations[0]), '001.setup.yaml'));
    const migrating = filby.applyYaml('add 2021 vat rates', changeSet('2021 VAT Rates', '2021-04-05T00:00:00.000Z'));
    await until(async () => (await countWaitingAdvisoryLocks()) > 0);

    const [beforeMigration] = await getNotifications('VAT Rates Changed');
    eq(beforeMigration.status, 'PENDING');

    completeDelivery();
    await migrating;

    const notifications = await getNotifications('VAT Rates Changed');
    eq(notifications.length, 2);
    const [original, fresh] = notifications;
    eq(original.status, 'OK');
    eq(original.attempts, 1);
    eq(fresh.status, 'PENDING');
    eq(fresh.attempts, 0);
    ok(fresh.id > original.id);
  });
});

function changeSet(description, effective) {
  return `
- operation: ADD_CHANGE_SET
  description: ${description}
  effective: ${effective}
  frames:
    - entity: VAT Rate
      version: 1
      action: SET
      data:
        - type: standard
          rate: 0.2
`;
}
