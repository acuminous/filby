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
};

describe('Schema', () => {

  let filby;

  before(async () => {
    filby = new TestFilby(config);
    await filby.reset();
  });

  beforeEach(async () => {
    await filby.wipe();
  });

  after(async () => {
    await filby.stop();
  });

  describe('Projections', () => {
    it('should prevent duplicate projections', async () => {

      await filby.withTransaction(async (tx) => {
        await tx.query("INSERT INTO fby_projection (name, version) VALUES ('NOT DUPLICATE', 1)");
        await tx.query("INSERT INTO fby_projection (name, version) VALUES ('NOT DUPLICATE', 2)");

        await tx.query("INSERT INTO fby_projection (name, version) VALUES ('NOT DUPLICATE A', 1)");
        await tx.query("INSERT INTO fby_projection (name, version) VALUES ('NOT DUPLICATE B', 1)");
      });

      await rejects(async () => {
        await filby.withTransaction(async (tx) => {
          await tx.query("INSERT INTO fby_projection (name, version) VALUES ('DUPLICATE', 1)");
          await tx.query("INSERT INTO fby_projection (name, version) VALUES ('DUPLICATE', 1)");
        });
      }, (err) => {
        eq(err.code, '23505');
        return true;
      });
    });

    it('should enforce projections are named', async () => {
      await rejects(async () => {
        await filby.withTransaction(async (tx) => {
          await tx.query('INSERT INTO fby_projection (name, version) VALUES (NULL, 1)');
        });
      }, (err) => {
        eq(err.code, '23502');
        return true;
      });
    });

    it('should enforce projections are versioned', async () => {
      await rejects(async () => {
        await filby.withTransaction(async (tx) => {
          await tx.query("INSERT INTO fby_projection (name, version) VALUES ('OK', NULL)");
        });
      }, (err) => {
        eq(err.code, '23502');
        return true;
      });
    });
  });

  describe('Change Sets', () => {
    it('should prevent duplicate change sets', async () => {

      await filby.withTransaction(async (tx) => {
        await tx.query(`INSERT INTO fby_change_set (id, effective) VALUES
          (1, '2023-01-01T00:00:00.000Z'),
          (2, '2023-01-01T00:00:00.000Z')
        `);
      });

      await rejects(async () => {
        await filby.withTransaction(async (tx) => {
          await tx.query(`INSERT INTO fby_change_set (id, effective) VALUES
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
        await filby.withTransaction(async (tx) => {
          await tx.query('INSERT INTO fby_change_set (id, effective) VALUES (1, NULL)');
        });
      }, (err) => {
        eq(err.code, '23502');
        return true;
      });
    });

    it('should default last modified date to now', async () => {
      const checkpoint = new Date();

      await filby.withTransaction(async (tx) => {
        await tx.query(`INSERT INTO fby_change_set (id, effective, notes) VALUES
          (1, '2020-04-05T00:00:00.000Z', 'Countries')`);
      });

      const changeSet = await filby.getChangeSet(1);
      ok(changeSet.lastModified >= checkpoint);
    });

    it('should default entity tag to random hex', async () => {
      await filby.withTransaction(async (tx) => {
        await tx.query(`INSERT INTO fby_change_set (id, effective, notes) VALUES
          (1, '2020-04-05T00:00:00.000Z', 'Countries')`);
      });

      const changeSet = await filby.getChangeSet(1);
      match(changeSet.entityTag, /^[a-f|0-9]{20}$/);
    });
  });
});
