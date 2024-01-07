const { ok, strictEqual: eq, deepEqual: deq, rejects, match } = require('node:assert');
const { describe, it, before, beforeEach, after, afterEach } = require('zunit');

const TestReferenceDataFramework = require('./TestReferenceDataFramework');

const config = {
  migrations: 'test',
  database: {
    user: 'rdf_test',
    password: 'rdf_test',
  },
  notifications: {
    initialDelay: '0ms',
    interval: '100ms',
    maxAttempts: 3,
    maxRescheduleDelay: '100ms',
  },
};

describe('Schema', () => {

  let rdf;

  before(async () => {
    rdf = new TestReferenceDataFramework(config);
    await rdf.reset();
  });

  beforeEach(async () => {
    await rdf.wipe();
  });

  after(async () => {
    await rdf.stop();
  });

  describe('Projections', () => {
    it('should prevent duplicate projections', async () => {

      await rdf.withTransaction(async (tx) => {
        await tx.query("INSERT INTO rdf_projection (name, version) VALUES ('NOT DUPLICATE', 1)");
        await tx.query("INSERT INTO rdf_projection (name, version) VALUES ('NOT DUPLICATE', 2)");

        await tx.query("INSERT INTO rdf_projection (name, version) VALUES ('NOT DUPLICATE A', 1)");
        await tx.query("INSERT INTO rdf_projection (name, version) VALUES ('NOT DUPLICATE B', 1)");
      });

      await rejects(async () => {
        await rdf.withTransaction(async (tx) => {
          await tx.query("INSERT INTO rdf_projection (name, version) VALUES ('DUPLICATE', 1)");
          await tx.query("INSERT INTO rdf_projection (name, version) VALUES ('DUPLICATE', 1)");
        });
      }, (err) => {
        eq(err.code, '23505');
        return true;
      });
    });

    it('should enforce projections are named', async () => {
      await rejects(async () => {
        await rdf.withTransaction(async (tx) => {
          await tx.query('INSERT INTO rdf_projection (name, version) VALUES (NULL, 1)');
        });
      }, (err) => {
        eq(err.code, '23502');
        return true;
      });
    });

    it('should enforce projections are versioned', async () => {
      await rejects(async () => {
        await rdf.withTransaction(async (tx) => {
          await tx.query("INSERT INTO rdf_projection (name, version) VALUES ('OK', NULL)");
        });
      }, (err) => {
        eq(err.code, '23502');
        return true;
      });
    });
  });

  describe('Change Sets', () => {
    it('should prevent duplicate change sets', async () => {

      await rdf.withTransaction(async (tx) => {
        await tx.query(`INSERT INTO rdf_change_set (id, effective) VALUES
          (1, '2023-01-01T00:00:00.000Z'),
          (2, '2023-01-01T00:00:00.000Z')
        `);
      });

      await rejects(async () => {
        await rdf.withTransaction(async (tx) => {
          await tx.query(`INSERT INTO rdf_change_set (id, effective) VALUES
            (3, '2023-01-01T00:00:00.000Z'),
            (3, '2023-01-01T00:00:00.000Z')`);
        });
      }, (err) => {
        eq(err.code, '23505');
        return true;
      });
    });

    it('should enforce change sets have effective dates', async () => {
      await rejects(async () => {
        await rdf.withTransaction(async (tx) => {
          await tx.query('INSERT INTO rdf_change_set (id, effective) VALUES (1, NULL)');
        });
      }, (err) => {
        eq(err.code, '23502');
        return true;
      });
    });

    it('should default last modified date to now', async () => {
      const checkpoint = new Date();

      await rdf.withTransaction(async (tx) => {
        await tx.query(`INSERT INTO rdf_change_set (id, effective, notes) VALUES
          (1, '2020-04-05T00:00:00.000Z', 'Countries')`);
      });

      const changeSet = await rdf.getChangeSet(1);
      ok(changeSet.lastModified >= checkpoint);
    });

    it('should default entity tag to random hex', async () => {
      await rdf.withTransaction(async (tx) => {
        await tx.query(`INSERT INTO rdf_change_set (id, effective, notes) VALUES
          (1, '2020-04-05T00:00:00.000Z', 'Countries')`);
      });

      const changeSet = await rdf.getChangeSet(1);
      match(changeSet.entityTag, /^[a-f|0-9]{20}$/);
    });
  });
});
