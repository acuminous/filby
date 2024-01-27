const { ok, strictEqual: eq, deepEqual: deq, rejects, match } = require('node:assert');
const { describe, it, before, beforeEach, after, afterEach } = require('zunit');

const TestFilby = require('./TestFilby');

const config = {
  migrations: [
    {
      path: 'test',
      permissions: ['ALL'],
    },
  ],
  database: {
    user: 'fby_test',
    password: 'fby_test',
  },
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

  it('should notify interested parties of projection changes', async (t, done) => {
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

    filby.subscribe('VAT Rate Changed', (notification) => {
      deq(notification.hook, { name: 'VAT Rate Changed', event: 'ADD_CHANGE_SET' });
      deq(notification.projection, { name: 'VAT Rates', version: 1, key: 'VAT Rates v1' });
      eq(notification.attempts, 1);
      done();
    });

    filby.startNotifications();
  });

  it('should not redeliver successful notifications', async (t, done) => {
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

    let attempts = 0;
    filby.subscribe('VAT Rate Changed', () => {
      eq(++attempts, 1);
      setTimeout(done, 1000);
    });

    filby.startNotifications();
  });

  it('should redeliver unsuccessful notifications up to the maximum number of attempts', async (t, done) => {
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

    let attempt = 0;
    filby.subscribe('VAT Rate Changed', async () => {
      attempt++;
      throw new Error('Oh Noes!');
    });

    setTimeout(async () => {
      eq(attempt, 3);
      done();
    }, 500);

    filby.startNotifications();
  });

  it('should capture the last delivery error', async (t, done) => {
    const checkpoint = new Date();

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

    let attempt = 0;
    filby.subscribe('VAT Rate Changed', () => {
      attempt++;
      throw new Error(`Oh Noes! ${attempt}`);
    });

    setTimeout(async () => {
      const { rows: notifications } = await filby.withTransaction(async (tx) => tx.query('SELECT * FROM fby_notification'));
      eq(notifications.length, 1);
      eq(notifications[0].status, 'PENDING');
      ok(notifications[0].last_attempted > checkpoint);
      match(notifications[0].last_error, /Oh Noes! 3/);
      done();
    }, 500);

    filby.startNotifications();
  });

  it('should emit an event when the last notification attempt fails', async (t, done) => {
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

    filby.subscribe('VAT Rate Changed', () => {
      throw new Error('Oh Noes!');
    });

    filby.subscribe(TestFilby.HOOK_MAX_ATTEMPTS_EXHAUSTED, (notification) => {
      eq(notification.err.message, 'Oh Noes!');
      deq(notification.hook, { name: 'VAT Rate Changed', event: 'ADD_CHANGE_SET' });
      deq(notification.projection, { name: 'VAT Rates', version: 1, key: 'VAT Rates v1' });
      eq(notification.attempts, 3);
      setTimeout(done, 1000);
    });

    filby.startNotifications();
  });

  it('should unsubscribe interested parties', async (t, done) => {
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

    function fail() {
      done(new Error('Not unsubscribed'));
    }

    filby.subscribe('VAT Rate Changed', fail);
    filby.unsubscribe('VAT Rate Changed', fail);

    filby.startNotifications();

    setTimeout(() => done(), 200);
  });
});
