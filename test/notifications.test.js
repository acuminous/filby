const { ok, strictEqual: eq, deepEqual: deq, match } = require('node:assert');
const { describe, it, before, beforeEach, after, afterEach } = require('node:test');
const pipsqueak = require('pipsqueak');

const schedulers = [];
const { promiseApi } = pipsqueak;
pipsqueak.promiseApi = (options) => {
  const scheduler = promiseApi(options);
  schedulers.push(scheduler);
  return scheduler;
};

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
    schedulers.length = 0;
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

  it('should keep the successful notifications of other projections when passing a notification from a general hook', async () => {
    const { rows: [pending] } = await filby.withTransaction(async (tx) => {
      await tx.query(`INSERT INTO fby_hook (id, name, event) VALUES
        (3, 'Rate Changed', 'ADD_CHANGE_SET')`);
      await tx.query(`INSERT INTO fby_notification (hook_id, projection_name, projection_version, status) VALUES
        (3, 'VAT Rates', 1, 'OK'),
        (3, 'CGT Rates', 1, 'OK')`);
      return tx.query(`INSERT INTO fby_notification (hook_id, projection_name, projection_version) VALUES
        (3, 'VAT Rates', 1) RETURNING id`);
    });

    await filby.withTransaction((tx) => tx.query('SELECT fby_pass_notification($1)', [pending.id]));

    const { rows } = await filby.withTransaction((tx) => tx.query('SELECT projection_name, status FROM fby_notification WHERE hook_id = 3 ORDER BY projection_name'));
    deq(rows, [
      { projection_name: 'CGT Rates', status: 'OK' },
      { projection_name: 'VAT Rates', status: 'OK' },
    ]);
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

  it('should pass an abort signal to handlers', async () => {
    await setup();

    let context;
    filby.subscribe('VAT Rate Changed', (_notification, ctx) => {
      context = ctx;
    });

    filby.startNotifications();

    await until(async () => (await getNotifications())[0].status === 'OK');

    ok(context.signal instanceof AbortSignal);
    eq(context.signal.aborted, false);
  });

  it('should fail a notification when the handler times out', async () => {
    await setup();

    const other = new TestFilby({ ...config, notifications: { ...config.notifications, handlerTimeout: '100ms' } });
    const signals = [];
    other.subscribe('VAT Rate Changed', (_notification, { signal }) => {
      signals.push(signal);
      return new Promise(() => {});
    });

    const checkpoint = await getDatabaseTime();
    try {
      other.startNotifications();

      await until(async () => (await getNotifications())[0].attempts === 1);

      const notifications = await getNotifications();
      eq(notifications[0].status, 'PENDING');
      ok(notifications[0].last_attempted >= checkpoint);
      match(notifications[0].last_error, /timed out after 100ms/);
      eq(signals.length, 1);
      eq(signals[0].aborted, true);

      await until(async () => (await getNotifications())[0].attempts === 2);
      eq(signals.length, 2);
    } finally {
      await other.stop();
    }
  });

  it('should emit an event when the last notification attempt times out', async () => {
    await setup();

    const other = new TestFilby({ ...config, notifications: { ...config.notifications, handlerTimeout: '100ms' } });
    other.subscribe('VAT Rate Changed', () => new Promise(() => {}));

    try {
      const exhausted = once(other, TestFilby.HOOK_MAX_ATTEMPTS_EXHAUSTED);
      other.startNotifications();
      const notification = await exhausted;

      match(notification.err.message, /timed out after 100ms/);
      eq(notification.attempts, 3);
    } finally {
      await other.stop();
    }
  });

  it('should abort inflight deliveries when stopping', async () => {
    await setup();

    const entered = Promise.withResolvers();
    let signal;
    filby.subscribe('VAT Rate Changed', (_notification, ctx) => {
      signal = ctx.signal;
      entered.resolve();
      return new Promise(() => {});
    });

    filby.startNotifications();
    await entered.promise;
    await filby.stopNotifications();

    eq(signal.aborted, true);
    const notifications = await getNotifications();
    eq(notifications[0].status, 'PENDING');
    eq(notifications[0].attempts, 1);
    match(notifications[0].last_error, /stopped/);
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

  it('should unsubscribe all interested parties from an event when no handler is specified', async () => {
    await setup();

    let calledFirst = false;
    let calledSecond = false;
    function first() {
      calledFirst = true;
    }
    function second() {
      calledSecond = true;
    }

    filby.subscribe('VAT Rate Changed', first);
    filby.subscribe('VAT Rate Changed', second);
    filby.unsubscribe('VAT Rate Changed');

    filby.startNotifications();

    await until(async () => (await getNotifications())[0].status === 'OK');

    eq(calledFirst, false);
    eq(calledSecond, false);
  });

  it('should ignore startNotifications when already polling', async () => {
    await filby.startNotifications();
    await filby.startNotifications();

    eq(schedulers.length, 1);
  });

  it('should stop polling after startNotifications was called twice', async () => {
    await filby.startNotifications();
    await filby.startNotifications();
    await filby.stopNotifications();

    deq(schedulers.map((scheduler) => scheduler.status('filby')), ['stopped']);
  });

  it('should start polling again after stopNotifications', async () => {
    await setup();

    const vatDelivered = once(filby, 'VAT Rate Changed');
    await filby.startNotifications();
    await vatDelivered;
    await filby.stopNotifications();

    const cgtDelivered = once(filby, 'CGT Rate Changed');
    await filby.withTransaction(async (tx) => {
      await tx.query(`INSERT INTO fby_notification (hook_id, projection_name, projection_version) VALUES
        (2, 'CGT Rates', 1)`);
    });
    await filby.startNotifications();
    await cgtDelivered;

    eq(schedulers.length, 2);
  });

  it('should deliver a notification to only one of several instances polling concurrently', async () => {
    await setup();

    const other = new TestFilby(config);
    const deliveries = [];
    const entered = Promise.withResolvers();
    const released = Promise.withResolvers();
    const handler = async (notification) => {
      deliveries.push(notification);
      entered.resolve();
      await released.promise;
    };

    try {
      filby.subscribe('VAT Rate Changed', handler);
      other.subscribe('VAT Rate Changed', handler);

      filby.startNotifications();
      await entered.promise;

      let polls = 0;
      other.startNotifications();
      schedulers[1].on('end', () => polls++);
      await until(() => polls > 0);

      released.resolve();
      await until(async () => (await getNotifications())[0].status === 'OK');

      eq(deliveries.length, 1);
      eq((await getNotifications()).length, 1);
    } finally {
      released.resolve();
      await other.stop();
    }
  });
});
