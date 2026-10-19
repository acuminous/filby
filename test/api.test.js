const { ok, strictEqual: eq, deepEqual: deq } = require('node:assert');
const { describe, it, before, beforeEach, after, afterEach } = require('node:test');

const TestFilby = require('./TestFilby');

const config = {
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
    await filby.wipe();
  });

  afterEach(async () => {
    await filby.stopNotifications();
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
      deq(projections[0], { id: 1, name: 'VAT Rates', version: 1, key: 'VAT Rates v1' });
      deq(projections[1], { id: 2, name: 'VAT Rates', version: 2, key: 'VAT Rates v2' });
      deq(projections[2], { id: 3, name: 'CGT Rates', version: 1, key: 'CGT Rates v1' });
    });

    it('should get projection by name and version', async () => {
      await filby.withTransaction(async (tx) => {
        await tx.query(`INSERT INTO fby_projection VALUES
          (1, 'VAT Rates', 1),
          (2, 'VAT Rates', 2),
          (3, 'CGT Rates', 1)`);
      });

      const projection = await filby.getProjection('VAT Rates', 2);
      deq(projection, { id: 2, name: 'VAT Rates', version: 2, key: 'VAT Rates v2' });
    });
  });

  describe('Change Sets', () => {

    it('should yield current change set for the given projection', async () => {
      const currentYear = new Date().getFullYear();
      const previousYear = currentYear - 1;
      const nextYear = currentYear + 1;

      await filby.withTransaction(async (tx) => {
        await tx.query(`INSERT INTO fby_projection (id, name, version) VALUES
            (1, 'VAT Rates', 1),
            (2, 'CGT Rates', 1)`);
        await tx.query(`INSERT INTO fby_entity (id, name, version) VALUES
            (1, 'VAT Rate', 1),
            (2, 'CGT Rate', 1)
          `);
        await tx.query(`INSERT INTO fby_projection_entity (projection_id, entity_id) VALUES
            (1, 1),
            (2, 2)`);
        await tx.query(`INSERT INTO fby_change_set (id, effective, description) VALUES
            (1, '${previousYear}-01-05T00:00:00.000Z', '${previousYear} VAT Rates'),
            (2, '${previousYear}-01-05T00:00:00.000Z', '${previousYear} CGT Rates'),
            (3, '${currentYear}-01-05T00:00:00.000Z', '${currentYear} VAT Rates'),
            (4, '${currentYear}-01-05T00:00:00.000Z', '${currentYear} CGT Rates'),
            (5, '${nextYear}-01-01T00:00:00.000Z', '${nextYear} VAT Rates'),
            (6, '${nextYear}-01-01T00:00:00.000Z', '${nextYear} CGT Rates')`);
        await tx.query(`INSERT INTO fby_data_frame (change_set_id, entity_id, action) VALUES
            (1, 1, 'SET'),
            (2, 2, 'SET'),
            (3, 1, 'SET'),
            (4, 2, 'SET'),
            (5, 1, 'SET'),
            (6, 2, 'SET')`);
      });

      const projection = await filby.getProjection('VAT Rates', 1);
      const changeSet = await filby.getCurrentChangeSet(projection);
      eq(changeSet.id, 3);
    });

    it('should not assume change sets are in order of effective date', async () => {
      const currentYear = new Date().getFullYear();
      const previousYear = currentYear - 1;
      const nextYear = currentYear + 1;

      await filby.withTransaction(async (tx) => {
        await tx.query(`INSERT INTO fby_projection (id, name, version) VALUES
            (1, 'VAT Rates', 1),
            (2, 'CGT Rates', 1)`);
        await tx.query(`INSERT INTO fby_entity (id, name, version) VALUES
            (1, 'VAT Rate', 1),
            (2, 'CGT Rate', 1)
          `);
        await tx.query(`INSERT INTO fby_projection_entity (projection_id, entity_id) VALUES
            (1, 1),
            (2, 2)`);
        await tx.query(`INSERT INTO fby_change_set (id, effective, description) VALUES
            (1, '${nextYear}-01-01T00:00:00.000Z', '${nextYear} CGT Rates'),
            (2, '${nextYear}-01-01T00:00:00.000Z', '${nextYear} VAT Rates'),
            (3, '${currentYear}-01-05T00:00:00.000Z', '${currentYear} CGT Rates'),
            (4, '${currentYear}-01-05T00:00:00.000Z', '${currentYear} VAT Rates'),
            (5, '${previousYear}-01-05T00:00:00.000Z', '${previousYear} CGT Rates'),
            (6, '${previousYear}-01-05T00:00:00.000Z', '${previousYear} VAT Rates')`);
        await tx.query(`INSERT INTO fby_data_frame (change_set_id, entity_id, action) VALUES
            (1, 1, 'SET'),
            (2, 2, 'SET'),
            (3, 1, 'SET'),
            (4, 2, 'SET'),
            (5, 1, 'SET'),
            (6, 2, 'SET')`);
      });

      const projection = await filby.getProjection('VAT Rates', 1);
      const changeSet = await filby.getCurrentChangeSet(projection);
      eq(changeSet.id, 3);
    });

    it('should yield undefined for the given projection when there is no current data', async () => {
      const currentYear = new Date().getFullYear();
      const nextYear = currentYear + 1;

      await filby.withTransaction(async (tx) => {
        await tx.query(`INSERT INTO fby_projection (id, name, version) VALUES
            (1, 'VAT Rates', 1),
            (2, 'CGT Rates', 1)`);
        await tx.query(`INSERT INTO fby_entity (id, name, version) VALUES
            (1, 'VAT Rate', 1),
            (2, 'CGT Rate', 1)
          `);
        await tx.query(`INSERT INTO fby_projection_entity (projection_id, entity_id) VALUES
            (1, 1),
            (2, 2)`);
        await tx.query(`INSERT INTO fby_change_set (id, effective, description) VALUES
            (1, '${nextYear}-01-05T00:00:00.000Z', '${nextYear} VAT Rates'),
            (2, '${nextYear}-01-05T00:00:00.000Z', '${nextYear} CGT Rates')`);
        await tx.query(`INSERT INTO fby_data_frame (change_set_id, entity_id, action) VALUES
            (1, 1, 'SET'),
            (2, 2, 'SET')`);
      });

      const projection = await filby.getProjection('VAT Rates', 1);
      const changeSet = await filby.getCurrentChangeSet(projection);
      eq(changeSet, undefined);
    });

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
          (1, 1, 'SET'),
          (2, 2, 'SET'),
          (3, 3, 'SET'),
          (4, 2, 'SET'),
          (5, 3, 'SET')`);
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
          (1, 1, 'SET'),
          (1, 2, 'SET'),
          (1, 2, 'SET')`);
      });

      const projection = await filby.getProjection('VAT Rates', 1);
      const changelog = (await filby.getChangeLog(projection)).map(({ id, effective, description }) => ({ id, effective: effective.toISOString(), description }));
      eq(changelog.length, 1);
      deq(changelog[0], { id: 1, effective: '2020-04-05T00:00:00.000Z', description: 'Everything' });
    });

    it('should exclude superseded change sets from the change log', async () => {
      await filby.withTransaction(async (tx) => {
        await tx.query(`INSERT INTO fby_projection (id, name, version) VALUES
          (1, 'VAT Rates', 1)`);
        await tx.query(`INSERT INTO fby_entity (id, name, version) VALUES
          (1, 'VAT Rate', 1)`);
        await tx.query(`INSERT INTO fby_projection_entity (projection_id, entity_id) VALUES
          (1, 1)`);
        await tx.query(`INSERT INTO fby_change_set (id, effective, description) VALUES
          (1, '2021-04-05T00:00:00.000Z', '2021 VAT Rates'),
          (2, '2020-04-05T00:00:00.000Z', '2020 VAT Rates'),
          (3, '2021-04-05T00:00:00.000Z', '2021 VAT Rates')`);
        await tx.query(`INSERT INTO fby_data_frame (change_set_id, entity_id, action) VALUES
          (1, 1, 'SET'),
          (2, 1, 'SET'),
          (3, 1, 'SET')`);
        await tx.query('UPDATE fby_change_set SET superseded_by = 3 WHERE id = 1');
        await tx.query('UPDATE fby_change_set SET reissued_from = 1 WHERE id = 3');
      });

      const projection = await filby.getProjection('VAT Rates', 1);
      const changelog = await filby.getChangeLog(projection);
      deq(changelog.map(({ id }) => id), [2, 3]);

      const superseded = await filby.getChangeSet(1);
      eq(superseded.id, 1);
      eq(superseded.reissuedFrom, undefined);

      const reissued = await filby.getChangeSet(3);
      eq(reissued.reissuedFrom, 1);
      eq(changelog.find(({ id }) => id === 3).reissuedFrom, 1);
    });

    it('should not yield a superseded change set as current', async () => {
      const currentYear = new Date().getFullYear();
      const previousYear = currentYear - 1;
      const nextYear = currentYear + 1;

      await filby.withTransaction(async (tx) => {
        await tx.query(`INSERT INTO fby_projection (id, name, version) VALUES
          (1, 'VAT Rates', 1)`);
        await tx.query(`INSERT INTO fby_entity (id, name, version) VALUES
          (1, 'VAT Rate', 1)`);
        await tx.query(`INSERT INTO fby_projection_entity (projection_id, entity_id) VALUES
          (1, 1)`);
        await tx.query(`INSERT INTO fby_change_set (id, effective, description) VALUES
          (1, '${previousYear}-01-01T00:00:00.000Z', 'January VAT Rates'),
          (2, '${previousYear}-06-01T00:00:00.000Z', 'June VAT Rates'),
          (3, '${nextYear}-01-01T00:00:00.000Z', 'Next Year VAT Rates')`);
        await tx.query(`INSERT INTO fby_data_frame (change_set_id, entity_id, action) VALUES
          (1, 1, 'SET'),
          (2, 1, 'SET'),
          (3, 1, 'SET')`);
        await tx.query('UPDATE fby_change_set SET superseded_by = 3 WHERE id = 2');
      });

      const projection = await filby.getProjection('VAT Rates', 1);
      const changeSet = await filby.getCurrentChangeSet(projection);
      eq(changeSet.id, 1);
    });

    it('should list change sets in order of change set id when added out of effective order', async (t) => {
      await filby.applyYaml(t.name, `
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
      version: 1`, vatRate('2020', 0.1), vatRate('2023', 0.25), vatRate('2022', 0.2), vatRate('2021', 0.15));

      const { rows } = await filby.withTransaction((tx) => tx.query('SELECT id FROM fby_change_set WHERE superseded_by IS NOT NULL'));
      const supersededIds = rows.map(({ id }) => id);
      eq(supersededIds.length, 3);

      const projection = await filby.getProjection('VAT Rates', 1);
      const changelog = await filby.getChangeLog(projection);
      const ids = changelog.map(({ id }) => id);
      deq(ids, [...ids].sort((a, b) => a - b));
      deq(changelog.map(({ description }) => description), ['2020 VAT Rates', '2021 VAT Rates', '2022 VAT Rates', '2023 VAT Rates']);
      eq(ids.some((id) => supersededIds.includes(id)), false);

      const current = await filby.getCurrentChangeSet(projection);
      eq(current.id, ids[3]);
      eq(supersededIds.includes(current.reissuedFrom), true);

      for (const id of supersededIds) {
        eq((await filby.getChangeSet(id)).id, id);
      }
    });

    it('should not read data frames to find the current change set', async () => {
      const { rows } = await filby.withTransaction((tx) => tx.query(`
        EXPLAIN (FORMAT JSON)
        SELECT change_set_id
        FROM fby_projection_change_log_vw
        WHERE projection_id = 1 AND effective <= now()
        ORDER BY effective DESC, change_set_id DESC
        LIMIT 1`));
      const plan = JSON.stringify(rows[0]['QUERY PLAN']);
      ok(plan.includes('fby_change_set_entity'), plan);
      ok(!plan.includes('fby_data_frame'), plan);
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

  function vatRate(year, rate) {
    return `
- operation: ADD_CHANGE_SET
  description: ${year} VAT Rates
  effective: ${year}-04-05T00:00:00.000Z
  frames:
    - entity: VAT Rate
      version: 1
      action: SET
      data:
        - type: standard
          rate: ${rate}`;
  }
});
