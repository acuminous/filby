const { ok, strictEqual: eq, deepEqual: deq } = require('node:assert');
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
    await tx.query('DROP FUNCTION IF EXISTS get_vat_rate_v1_aggregate');
    await tx.query('DROP TABLE IF EXISTS cgt_rate_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_cgt_rate_v1_aggregate');
  },
};

const VAT_RATES = rates('VAT');
const CGT_RATES = rates('CGT');

const COMMENCE_VAT_RATES = `
- operation: ADD_HOOK
  name: VAT Rates Commenced
  event: COMMENCE_CHANGE_SET
  projection: VAT Rates
  version: 1
`;

const COMMENCE_ALL_RATES = `
- operation: ADD_HOOK
  name: Rates Commenced
  event: COMMENCE_CHANGE_SET
`;

const ADD_ALL_RATES = `
- operation: ADD_HOOK
  name: Rates Changed
  event: ADD_CHANGE_SET
`;

const VAT_RATES_V2 = `
- operation: ADD_PROJECTION
  name: VAT Rates
  version: 2
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

describe('Commencement', () => {

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

  async function getDatabaseTime() {
    const { rows } = await filby.withTransaction((tx) => tx.query('SELECT now()'));
    return rows[0].now;
  }

  async function getNotifications(hookName) {
    const { rows } = await filby.withTransaction((tx) => tx.query(`
      SELECT n.*
      FROM fby_notification n
      INNER JOIN fby_hook h ON h.id = n.hook_id
      WHERE h.name = $1
      ORDER BY n.scheduled_for, n.projection_name, n.projection_version`, [hookName]));
    return rows;
  }

  it('should deliver a commencement for a change set with a past effective date', async (t) => {
    await filby.applyYaml(t.name, VAT_RATES, COMMENCE_VAT_RATES, changeSet('VAT', '2020 VAT Rates', '2020-04-05T00:00:00.000Z'));

    const delivered = once(filby, 'VAT Rates Commenced');
    filby.startNotifications();
    const notification = await delivered;

    deq(notification.hook, { name: 'VAT Rates Commenced', event: 'COMMENCE_CHANGE_SET' });
    deq(notification.projection, { name: 'VAT Rates', version: 1, key: 'VAT Rates v1' });
    eq(notification.attempts, 1);
  });

  it('should deliver a commencement when a pre-released change set reaches its effective date', async (t) => {
    const effective = new Date((await getDatabaseTime()).getTime() + 2000);
    await filby.applyYaml(t.name, VAT_RATES, COMMENCE_VAT_RATES, changeSet('VAT', 'Future VAT Rates', effective.toISOString()));

    const [scheduled] = await getNotifications('VAT Rates Commenced');
    eq(scheduled.status, 'PENDING');
    deq(scheduled.scheduled_for, effective);

    const delivered = once(filby, 'VAT Rates Commenced');
    filby.startNotifications();
    await delivered;
    await until(async () => (await getNotifications('VAT Rates Commenced'))[0].status === 'OK');

    const [commenced] = await getNotifications('VAT Rates Commenced');
    ok(commenced.last_attempted >= effective);
  });

  it('should schedule a commencement for each pre-released effective date', async (t) => {
    await filby.applyYaml(
      t.name,
      VAT_RATES,
      COMMENCE_VAT_RATES,
      ADD_VAT_RATES,
      changeSet('VAT', '2030 VAT Rates', '2030-01-01T00:00:00.000Z'),
      changeSet('VAT', '2031 VAT Rates', '2031-01-01T00:00:00.000Z'),
    );

    const commencements = await getNotifications('VAT Rates Commenced');
    deq(commencements.map(({ status, scheduled_for }) => ({ status, scheduled_for })), [
      { status: 'PENDING', scheduled_for: new Date('2030-01-01T00:00:00.000Z') },
      { status: 'PENDING', scheduled_for: new Date('2031-01-01T00:00:00.000Z') },
    ]);

    const additions = await getNotifications('VAT Rates Changed');
    eq(additions.length, 1);
    eq(additions[0].status, 'PENDING');
  });

  it('should schedule a projection specific commencement only for its projection', async (t) => {
    await filby.applyYaml(
      t.name,
      VAT_RATES,
      CGT_RATES,
      COMMENCE_VAT_RATES,
      changeSet('VAT', '2030 VAT Rates', '2030-01-01T00:00:00.000Z'),
      changeSet('CGT', '2030 CGT Rates', '2030-01-01T00:00:00.000Z'),
    );

    const commencements = await getNotifications('VAT Rates Commenced');
    deq(commencements.map(({ projection_name, projection_version }) => ({ projection_name, projection_version })), [
      { projection_name: 'VAT Rates', projection_version: 1 },
    ]);
  });

  it('should schedule a general commencement for every projection', async (t) => {
    await filby.applyYaml(
      t.name,
      VAT_RATES,
      CGT_RATES,
      COMMENCE_ALL_RATES,
      changeSet('VAT', '2030 VAT Rates', '2030-01-01T00:00:00.000Z'),
      changeSet('CGT', '2030 CGT Rates', '2030-01-01T00:00:00.000Z'),
    );

    const commencements = await getNotifications('Rates Commenced');
    deq(commencements.map(({ projection_name, projection_version }) => ({ projection_name, projection_version })), [
      { projection_name: 'CGT Rates', projection_version: 1 },
      { projection_name: 'VAT Rates', projection_version: 1 },
    ]);
  });

  it('should schedule the commencement of a re-issued change set for its inherited effective date', async (t) => {
    await filby.applyYaml(
      t.name,
      VAT_RATES,
      COMMENCE_VAT_RATES,
      changeSet('VAT', '2031 VAT Rates', '2031-01-01T00:00:00.000Z'),
      changeSet('VAT', '2030 VAT Rates', '2030-01-01T00:00:00.000Z'),
    );

    const { rows: [original, , reissued] } = await filby.withTransaction((tx) => tx.query('SELECT id, description, superseded_by, reissued_from FROM fby_change_set ORDER BY id'));
    eq(original.superseded_by, reissued.id);
    eq(reissued.reissued_from, original.id);
    eq(reissued.description, '2031 VAT Rates');

    const commencements = await getNotifications('VAT Rates Commenced');
    deq(commencements.map(({ status, scheduled_for }) => ({ status, scheduled_for })), [
      { status: 'PENDING', scheduled_for: new Date('2030-01-01T00:00:00.000Z') },
      { status: 'PENDING', scheduled_for: new Date('2031-01-01T00:00:00.000Z') },
    ]);
    ok(commencements[1].id > commencements[0].id);
  });

  it('should schedule commencements for future change sets added before a general hook and projection', async (t) => {
    await filby.applyYaml(
      t.name,
      VAT_RATES,
      changeSet('VAT', '2099 VAT Rates', '2099-01-01T00:00:00.000Z'),
      COMMENCE_ALL_RATES,
      VAT_RATES_V2,
    );

    const commencements = await getNotifications('Rates Commenced');
    deq(commencements.map(({ status, projection_name, projection_version, scheduled_for }) => ({ status, projection_name, projection_version, scheduled_for })), [
      { status: 'PENDING', projection_name: 'VAT Rates', projection_version: 1, scheduled_for: new Date('2099-01-01T00:00:00.000Z') },
      { status: 'PENDING', projection_name: 'VAT Rates', projection_version: 2, scheduled_for: new Date('2099-01-01T00:00:00.000Z') },
    ]);
  });

  it('should schedule commencements for future change sets added before a projection specific hook only for its projection', async (t) => {
    await filby.applyYaml(
      t.name,
      VAT_RATES,
      CGT_RATES,
      changeSet('VAT', '2030 VAT Rates', '2030-01-01T00:00:00.000Z'),
      changeSet('CGT', '2030 CGT Rates', '2030-01-01T00:00:00.000Z'),
      changeSet('VAT', '2031 VAT Rates', '2031-01-01T00:00:00.000Z'),
      COMMENCE_VAT_RATES,
    );

    const commencements = await getNotifications('VAT Rates Commenced');
    deq(commencements.map(({ projection_name, projection_version, scheduled_for }) => ({ projection_name, projection_version, scheduled_for })), [
      { projection_name: 'VAT Rates', projection_version: 1, scheduled_for: new Date('2030-01-01T00:00:00.000Z') },
      { projection_name: 'VAT Rates', projection_version: 1, scheduled_for: new Date('2031-01-01T00:00:00.000Z') },
    ]);
  });

  it('should not schedule commencements for change sets already in effect when the hook is added', async (t) => {
    await filby.applyYaml(
      t.name,
      VAT_RATES,
      changeSet('VAT', '2020 VAT Rates', '2020-04-05T00:00:00.000Z'),
      COMMENCE_ALL_RATES,
      VAT_RATES_V2,
    );

    const commencements = await getNotifications('Rates Commenced');
    eq(commencements.length, 0);
  });

  it('should not schedule commencements for a new projection from a projection specific hook', async (t) => {
    await filby.applyYaml(
      t.name,
      VAT_RATES,
      COMMENCE_VAT_RATES,
      changeSet('VAT', '2030 VAT Rates', '2030-01-01T00:00:00.000Z'),
      VAT_RATES_V2,
    );

    const commencements = await getNotifications('VAT Rates Commenced');
    deq(commencements.map(({ projection_name, projection_version }) => ({ projection_name, projection_version })), [
      { projection_name: 'VAT Rates', projection_version: 1 },
    ]);
  });

  it('should not schedule change set additions for a new projection', async (t) => {
    await filby.applyYaml(
      t.name,
      VAT_RATES,
      ADD_ALL_RATES,
      changeSet('VAT', '2030 VAT Rates', '2030-01-01T00:00:00.000Z'),
      COMMENCE_ALL_RATES,
      VAT_RATES_V2,
    );

    const additions = await getNotifications('Rates Changed');
    deq(additions.map(({ projection_name, projection_version }) => ({ projection_name, projection_version })), [
      { projection_name: 'VAT Rates', projection_version: 1 },
    ]);
  });
});

function rates(tax) {
  return `
- operation: ADD_ENTITY
  name: ${tax} Rate
  version: 1
  fields:
    - name: type
      type: TEXT
    - name: rate
      type: NUMERIC
  identified_by:
    - type
- operation: ADD_PROJECTION
  name: ${tax} Rates
  version: 1
  dependencies:
    - entity: ${tax} Rate
      version: 1
`;
}

function changeSet(tax, description, effective) {
  return `
- operation: ADD_CHANGE_SET
  description: ${description}
  effective: ${effective}
  frames:
    - entity: ${tax} Rate
      version: 1
      action: SET
      data:
        - type: standard
          rate: 0.2
`;
}
