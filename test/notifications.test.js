const { ok, strictEqual: eq, deepEqual: deq, match } = require('node:assert');
const { describe, it, before, beforeEach, after, afterEach } = require('node:test');

const TestFilby = require('./TestFilby');
const { until, once } = require('./until');

const config = {
  notifications: {
    initialDelay: '0ms',
    interval: '100ms',
    maxAttempts: 3,
    maxRescheduleDelay: '100ms',
  },
  nukeCustomObjects: async (tx) => {
    await tx.query('DROP TABLE IF EXISTS vat_rate_v1');
  },
};

describe('Notifications', () => {

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
        (1, 'VAT Rates', 1),
        (2, 'CGT Rates', 1)`);
      await tx.query(`INSERT INTO fby_hook (id, name, event, projection_id) VALUES
        (1, 'VAT Rate Changed', 'ADD_CHANGE_SET', 1),
        (2, 'CGT Rate Changed', 'ADD_CHANGE_SET', 2)`);
      await tx.query(`INSERT INTO fby_notification (hook_id, projection_name, projection_version) VALUES
        (1, 'VAT Rates', 1)`);
    });
  }

  async function getDatabaseTime() {
    const { rows } = await filby.withTransaction((tx) => tx.query('SELECT now()'));
    return rows[0].now;
  }

  async function getNotifications() {
    const { rows } = await filby.withTransaction(async (tx) => tx.query('SELECT * FROM fby_notification WHERE hook_id = 1'));
    return rows;
  }

  it('should notify interested parties of projection changes', async () => {
    await setup();

    const delivered = once(filby, 'VAT Rate Changed');
    filby.startNotifications();
    const notification = await delivered;

    deq(notification.hook, { name: 'VAT Rate Changed', event: 'ADD_CHANGE_SET' });
    deq(notification.projection, { name: 'VAT Rates', version: 1, key: 'VAT Rates v1' });
    eq(notification.attempts, 1);
  });

  it('should not redeliver successful notifications', async () => {
    await setup();

    let attempts = 0;
    filby.subscribe('VAT Rate Changed', () => {
      attempts++;
    });

    const checkpoint = await getDatabaseTime();
    filby.startNotifications();

    await until(async () => (await getNotifications())[0].status === 'OK');
    const cgtDelivered = once(filby, 'CGT Rate Changed');
    await filby.withTransaction(async (tx) => {
      await tx.query(`INSERT INTO fby_notification (hook_id, projection_name, projection_version) VALUES
        (2, 'CGT Rates', 1)`);
    });
    await cgtDelivered;

    const notifications = await getNotifications();
    eq(attempts, 1);
    eq(notifications.length, 1);
    eq(notifications[0].status, 'OK');
    ok(notifications[0].last_attempted >= checkpoint);
    eq(notifications[0].last_error, null);
  });

  it('should redeliver unsuccessful notifications up to the maximum number of attempts', async () => {
    await setup();

    let attempt = 0;
    filby.subscribe('VAT Rate Changed', async () => {
      attempt++;
      throw new Error('Oh Noes!');
    });

    filby.startNotifications();

    await until(async () => (await getNotifications())[0].attempts === 3);
    const cgtDelivered = once(filby, 'CGT Rate Changed');
    await filby.withTransaction(async (tx) => {
      await tx.query(`INSERT INTO fby_notification (hook_id, projection_name, projection_version) VALUES
        (2, 'CGT Rates', 1)`);
    });
    await cgtDelivered;

    eq(attempt, 3);
  });

  it('should capture the last delivery error', async () => {
    await setup();

    let attempt = 0;
    filby.subscribe('VAT Rate Changed', () => {
      throw new Error(`Oh Noes! ${++attempt}`);
    });

    const checkpoint = await getDatabaseTime();
    filby.startNotifications();

    await until(async () => (await getNotifications())[0].attempts === 3);

    const notifications = await getNotifications();
    eq(notifications.length, 1);
    eq(notifications[0].status, 'PENDING');
    ok(notifications[0].last_attempted >= checkpoint);
    match(notifications[0].last_error, /Oh Noes! 3/);
  });

  it('should emit an event when the last notification attempt fails', async () => {
    await setup();

    filby.subscribe('VAT Rate Changed', () => {
      throw new Error('Oh Noes!');
    });

    const exhausted = once(filby, TestFilby.HOOK_MAX_ATTEMPTS_EXHAUSTED);
    filby.startNotifications();
    const notification = await exhausted;

    eq(notification.err.message, 'Oh Noes!');
    deq(notification.hook, { name: 'VAT Rate Changed', event: 'ADD_CHANGE_SET' });
    deq(notification.projection, { name: 'VAT Rates', version: 1, key: 'VAT Rates v1' });
    eq(notification.attempts, 3);
  });

  it('should unsubscribe interested parties', async () => {
    await setup();

    let called = false;
    function fail() {
      called = true;
    }

    filby.subscribe('VAT Rate Changed', fail);
    filby.unsubscribe('VAT Rate Changed', fail);

    filby.startNotifications();

    await until(async () => (await getNotifications())[0].status === 'OK');

    eq(called, false);
  });
});
