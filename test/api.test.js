const { ok, strictEqual: eq, deepEqual: deq, rejects, match } = require('node:assert');
const { describe, it, before, beforeEach, after, afterEach } = require('zunit');

const TestReferenceDataFramework = require('./TestReferenceDataFramework');

const config = {
  migrations: 'test',
  database: {
    user: 'rdf_test',
    password: 'rdf_test'
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
  }
};

describe('API', () => {

  let rdf;

  before(async () => {
    rdf = new TestReferenceDataFramework(config);
    await rdf.reset();
  });

  beforeEach(async () => {
    rdf.removeAllListeners();
    await rdf.wipe();
  });

  afterEach(async () => {
    await rdf.stopNotifications();
    rdf.removeAllListeners();
  });

  after(async () => {
    await rdf.stop();
  });

  describe('Projections', () => {

    it('should list projections', async () => {
      await rdf.withTransaction(async (tx) => {
        await tx.query(`INSERT INTO rdf_projection VALUES
          (1, 'VAT Rates', 1),
          (2, 'VAT Rates', 2),
          (3, 'CGT Rates', 1)`
        );
      });

      const projections = await rdf.getProjections();
      eq(projections.length, 3);
      deq(projections[0], { id: 1, name: 'VAT Rates', version: 1 });
      deq(projections[1], { id: 2, name: 'VAT Rates', version: 2 });
      deq(projections[2], { id: 3, name: 'CGT Rates', version: 1 });
    });

    it('should get projection by name and version', async () => {
      await rdf.withTransaction(async (tx) => {
        await tx.query(`INSERT INTO rdf_projection VALUES
          (1, 'VAT Rates', 1),
          (2, 'VAT Rates', 2),
          (3, 'CGT Rates', 1)`
        );
      });

      const projection = await rdf.getProjection('VAT Rates', 2);
      deq(projection, { id: 2, name: 'VAT Rates', version: 2 });
    });
  });

  describe('Change Sets', () => {

    it('should list change sets for the given projection', async () => {
      await rdf.withTransaction(async (tx) => {
        await tx.query(`INSERT INTO rdf_projection (id, name, version) VALUES
          (1, 'VAT Rates', 1),
          (2, 'CGT Rates', 1)`
        );
        await tx.query(`INSERT INTO rdf_entity (id, name, version) VALUES
          (1, 'Country', 1),
          (2, 'VAT Rate', 1),
          (3, 'CGT Rate', 1)
        `);
        await tx.query(`INSERT INTO rdf_projection_entity (projection_id, entity_id) VALUES
          (1, 1),
          (1, 2),
          (2, 1),
          (2, 3)`
        );
        await tx.query(`INSERT INTO rdf_change_set (id, effective, notes) VALUES
          (1, '2020-04-05T00:00:00.000Z', 'Countries'),
          (2, '2020-04-05T00:00:00.000Z', '2020 VAT Rates'),
          (3, '2020-04-05T00:00:00.000Z', '2020 CGT Rates'),
          (4, '2021-04-05T00:00:00.000Z', '2021 VAT Rates'),
          (5, '2021-04-05T00:00:00.000Z', '2021 CGT Rates')`
        );
        await tx.query(`INSERT INTO rdf_data_frame (change_set_id, entity_id, action) VALUES
          (1, 1, 'POST'),
          (2, 2, 'POST'),
          (3, 3, 'POST'),
          (4, 2, 'POST'),
          (5, 3, 'POST')`
        );
      });

      const projection = await rdf.getProjection('VAT Rates', 1);
      const changelog = (await rdf.getChangeLog(projection)).map(({ id, effectiveFrom, notes }) => ({ id, effectiveFrom: effectiveFrom.toISOString(), notes }));

      eq(changelog.length, 3);
      deq(changelog[0], { id: 1, effectiveFrom: '2020-04-05T00:00:00.000Z', notes: 'Countries' });
      deq(changelog[1], { id: 2, effectiveFrom: '2020-04-05T00:00:00.000Z', notes: '2020 VAT Rates' });
      deq(changelog[2], { id: 4, effectiveFrom: '2021-04-05T00:00:00.000Z', notes: '2021 VAT Rates' });
    });

    it('should dedupe change sets', async () => {
      await rdf.withTransaction(async (tx) => {
        await tx.query(`INSERT INTO rdf_projection (id, name, version) VALUES
          (1, 'VAT Rates', 1)`
        );
        await tx.query(`INSERT INTO rdf_entity (id, name, version) VALUES
          (1, 'Country', 1),
          (2, 'VAT Rate', 1)
        `);
        await tx.query(`INSERT INTO rdf_projection_entity (projection_id, entity_id) VALUES
          (1, 1),
          (1, 2)`
        );
        await tx.query(`INSERT INTO rdf_change_set (id, effective, notes) VALUES
          (1, '2020-04-05T00:00:00.000Z', 'Everything')`
        );
        await tx.query(`INSERT INTO rdf_data_frame (change_set_id, entity_id, action) VALUES
          (1, 1, 'POST'),
          (1, 2, 'POST'),
          (1, 2, 'POST')`
        );
      });

      const projection = await rdf.getProjection('VAT Rates', 1);
      const changelog = (await rdf.getChangeLog(projection)).map(({ id, effectiveFrom, notes }) => ({ id, effectiveFrom: effectiveFrom.toISOString(), notes }));
      eq(changelog.length, 1);
      deq(changelog[0], { id: 1, effectiveFrom: '2020-04-05T00:00:00.000Z', notes: 'Everything' });
    });

    it('should get change set by id', async () => {
      await rdf.withTransaction(async (tx) => {
        await tx.query(`INSERT INTO rdf_change_set (id, effective, notes) VALUES
          (1, '2020-04-05T00:00:00.000Z', 'Countries'),
          (2, '2020-04-05T00:00:00.000Z', '2020 VAT Rates'),
          (3, '2020-04-05T00:00:00.000Z', '2020 CGT Rates')`
        );
      });

      const changeSet = await rdf.getChangeSet(2);
      eq(changeSet.id, 2);
      eq(changeSet.effectiveFrom.toISOString(), '2020-04-05T00:00:00.000Z');
      eq(changeSet.notes, '2020 VAT Rates');
    });
  });
});
