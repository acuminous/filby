const { strictEqual: eq } = require('node:assert');
const { describe, it, before, beforeEach, after, afterEach } = require('node:test');
const { Client } = require('pg');

const TestFilby = require('./TestFilby');
const { until, once } = require('./until');

const config = {
  notifications: {
    initialDelay: '1h',
    interval: '1h',
    maxAttempts: 3,
    maxRescheduleDelay: '100ms',
    listen: true,
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
- operation: ADD_HOOK
  name: VAT Rates Changed
  event: ADD_CHANGE_SET
  projection: VAT Rates
  version: 1
- operation: ADD_CHANGE_SET
  description: 2020 VAT Rates
  effective: 2020-04-05T00:00:00.000Z
  frames:
    - entity: VAT Rate
      version: 1
      action: SET
      data:
        - type: standard
          rate: 0.2
`;

describe('Listen', () => {

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

  async function setup() {
    await filby.withTransaction(async (tx) => {
      await tx.query(`INSERT INTO fby_projection (id, name, version) VALUES
        (1, 'VAT Rates', 1)`);
      await tx.query(`INSERT INTO fby_hook (id, name, event, projection_id) VALUES
        (1, 'VAT Rate Changed', 'ADD_CHANGE_SET', 1)`);
    });
  }

  async function scheduleNotification() {
    await filby.withTransaction((tx) => tx.query("SELECT fby_schedule_notification(1, 'VAT Rates', 1)"));
  }

  async function getListeners() {
    const { rows } = await filby.withTransaction((tx) => tx.query("SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND query = 'LISTEN fby_notification' AND state = 'idle'"));
    return rows.map((row) => row.pid);
  }

  async function terminate(pid) {
    const client = new Client(filby.config.database);
    await client.connect();
    try {
      await client.query('SELECT pg_terminate_backend($1)', [pid]);
    } finally {
      await client.end();
    }
  }

  it('should deliver a notification without waiting for the next poll', async () => {
    await setup();
    await filby.startNotifications();

    const delivered = once(filby, 'VAT Rate Changed', { timeout: 1000 });
    await scheduleNotification();
    const notification = await delivered;

    eq(notification.hook.name, 'VAT Rate Changed');
    eq(notification.projection.key, 'VAT Rates v1');
  });

  it('should deliver a notification scheduled by a migration without waiting for the next poll', async (t) => {
    await filby.startNotifications();

    const delivered = once(filby, 'VAT Rates Changed', { timeout: 1000 });
    await filby.applyYaml(t.name, VAT_RATES);
    const notification = await delivered;

    eq(notification.projection.key, 'VAT Rates v1');
  });

  it('should report a dropped listening connection', async () => {
    await filby.startNotifications();
    const [pid] = await getListeners();

    const failed = once(filby, TestFilby.NOTIFICATION_ERROR);
    await terminate(pid);
    const { error } = await failed;

    eq(error.message, 'terminating connection due to administrator command');
  });

  it('should still deliver notifications on the next poll when the listening connection is dropped', async () => {
    await setup();

    const other = new TestFilby({ ...config, notifications: { ...config.notifications, initialDelay: '0ms', interval: '100ms' } });
    try {
      const delivered = once(other, 'VAT Rate Changed');
      other.subscribe(TestFilby.NOTIFICATION_ERROR, () => {});
      await other.startNotifications();
      const [pid] = await getListeners();

      await terminate(pid);
      await until(async () => (await getListeners()).length === 0);
      await scheduleNotification();
      const notification = await delivered;

      eq(notification.projection.key, 'VAT Rates v1');
    } finally {
      await other.stop();
    }
  });

  it('should reconnect when the listening connection is dropped', async () => {
    await setup();
    await filby.startNotifications();
    const [pid] = await getListeners();

    filby.subscribe(TestFilby.NOTIFICATION_ERROR, () => {});
    await terminate(pid);
    await until(async () => {
      const listeners = await getListeners();
      return listeners.length === 1 && listeners[0] !== pid;
    });

    const delivered = once(filby, 'VAT Rate Changed', { timeout: 1000 });
    await scheduleNotification();
    const notification = await delivered;

    eq(notification.projection.key, 'VAT Rates v1');
  });

  it('should stop listening when notifications are stopped', async () => {
    await filby.startNotifications();
    await until(async () => (await getListeners()).length === 1);

    await filby.stopNotifications();

    await until(async () => (await getListeners()).length === 0);
  });

  it('should not listen unless configured to', async () => {
    const other = new TestFilby({ ...config, notifications: { ...config.notifications, listen: false } });
    try {
      await other.startNotifications();

      eq((await getListeners()).length, 0);
    } finally {
      await other.stop();
    }
  });
});
