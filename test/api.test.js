const {
  ok, strictEqual: eq, deepEqual: deq, rejects, match,
} = require('node:assert');
const {
  describe, it, before, beforeEach, after, afterEach,
} = require('zunit');

const TestFilby = require('./TestFilby');

const config = {
  migrations: 'test',
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
    await tx.query('DROP FUNCTION IF EXISTS get_vat_rate_v1_aggregate');
    await tx.query('DROP TYPE IF EXISTS tax_rate_type');
  },
};

describe('API', () => {

  let filby;

  before(async () => {
    filby = new TestFilby(config);
    await filby.reset();
  });

  beforeEach(async () => {
    filby.removeAllListeners();
    await filby.wipe();
  });

  afterEach(async () => {
    await filby.stopNotifications();
    filby.removeAllListeners();
  });

  after(async () => {
    await filby.stop();
  });

  describe('Projections', () => {

    it('should list projections', async () => {
      await filby.withTransaction(async (tx) => {
        await tx.query(`INSERT INTO fby_projection VALUES
          (1, 'VAT Rates', 1),
          (2, 'VAT Rates', 2),
          (3, 'CGT Rates', 1)`);
      });

      const projections = await filby.getProjections();
      eq(projections.length, 3);
      deq(projections[0], { id: 1, name: 'VAT Rates', version: 1 });
      deq(projections[1], { id: 2, name: 'VAT Rates', version: 2 });
      deq(projections[2], { id: 3, name: 'CGT Rates', version: 1 });
    });

    it('should get projection by name and version', async () => {
      await filby.withTransaction(async (tx) => {
        await tx.query(`INSERT INTO fby_projection VALUES
          (1, 'VAT Rates', 1),
          (2, 'VAT Rates', 2),
          (3, 'CGT Rates', 1)`);
      });

      const projection = await filby.getProjection('VAT Rates', 2);
      deq(projection, { id: 2, name: 'VAT Rates', version: 2 });
    });
  });

  describe('Change Sets', () => {

    it('should list change sets for the given projection', async () => {
      await filby.withTransaction(async (tx) => {
        await tx.query(`INSERT INTO fby_projection (id, name, version) VALUES
          (1, 'VAT Rates', 1),
          (2, 'CGT Rates', 1)`);
        await tx.query(`INSERT INTO fby_entity (id, name, version) VALUES
          (1, 'Country', 1),
          (2, 'VAT Rate', 1),
          (3, 'CGT Rate', 1)
        `);
        await tx.query(`INSERT INTO fby_projection_entity (projection_id, entity_id) VALUES
          (1, 1),
          (1, 2),
          (2, 1),
          (2, 3)`);
        await tx.query(`INSERT INTO fby_change_set (id, effective, description) VALUES
          (1, '2020-04-05T00:00:00.000Z', 'Countries'),
          (2, '2020-04-05T00:00:00.000Z', '2020 VAT Rates'),
          (3, '2020-04-05T00:00:00.000Z', '2020 CGT Rates'),
          (4, '2021-04-05T00:00:00.000Z', '2021 VAT Rates'),
          (5, '2021-04-05T00:00:00.000Z', '2021 CGT Rates')`);
        await tx.query(`INSERT INTO fby_data_frame (change_set_id, entity_id, action) VALUES
          (1, 1, 'POST'),
          (2, 2, 'POST'),
          (3, 3, 'POST'),
          (4, 2, 'POST'),
          (5, 3, 'POST')`);
      });

      const projection = await filby.getProjection('VAT Rates', 1);
      const changelog = (await filby.getChangeLog(projection)).map(({ id, effective, description }) => ({ id, effective: effective.toISOString(), description }));

      eq(changelog.length, 3);
      deq(changelog[0], { id: 1, effective: '2020-04-05T00:00:00.000Z', description: 'Countries' });
      deq(changelog[1], { id: 2, effective: '2020-04-05T00:00:00.000Z', description: '2020 VAT Rates' });
      deq(changelog[2], { id: 4, effective: '2021-04-05T00:00:00.000Z', description: '2021 VAT Rates' });
    });

    it('should dedupe change sets', async () => {
      await filby.withTransaction(async (tx) => {
        await tx.query(`INSERT INTO fby_projection (id, name, version) VALUES
          (1, 'VAT Rates', 1)`);
        await tx.query(`INSERT INTO fby_entity (id, name, version) VALUES
          (1, 'Country', 1),
          (2, 'VAT Rate', 1)
        `);
        await tx.query(`INSERT INTO fby_projection_entity (projection_id, entity_id) VALUES
          (1, 1),
          (1, 2)`);
        await tx.query(`INSERT INTO fby_change_set (id, effective, description) VALUES
          (1, '2020-04-05T00:00:00.000Z', 'Everything')`);
        await tx.query(`INSERT INTO fby_data_frame (change_set_id, entity_id, action) VALUES
          (1, 1, 'POST'),
          (1, 2, 'POST'),
          (1, 2, 'POST')`);
      });

      const projection = await filby.getProjection('VAT Rates', 1);
      const changelog = (await filby.getChangeLog(projection)).map(({ id, effective, description }) => ({ id, effective: effective.toISOString(), description }));
      eq(changelog.length, 1);
      deq(changelog[0], { id: 1, effective: '2020-04-05T00:00:00.000Z', description: 'Everything' });
    });

    it('should get change set by id', async () => {
      await filby.withTransaction(async (tx) => {
        await tx.query(`INSERT INTO fby_change_set (id, effective, description) VALUES
          (1, '2020-04-05T00:00:00.000Z', 'Countries'),
          (2, '2020-04-05T00:00:00.000Z', '2020 VAT Rates'),
          (3, '2020-04-05T00:00:00.000Z', '2020 CGT Rates')`);
      });

      const changeSet = await filby.getChangeSet(2);
      eq(changeSet.id, 2);
      eq(changeSet.effective.toISOString(), '2020-04-05T00:00:00.000Z');
      eq(changeSet.description, '2020 VAT Rates');
    });
  });
});
