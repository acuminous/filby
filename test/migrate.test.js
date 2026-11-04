const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { strictEqual: eq, deepStrictEqual: deq, match, rejects } = require('node:assert');
const { describe, it, before, beforeEach, after } = require('node:test');
const { Client } = require('pg');

const { Filby } = require('..');

const run = promisify(execFile);
const cli = path.resolve('bin/filby.js');
const server = { user: 'fby_test', password: 'fby_test' };
const migrateDatabase = `${process.env.PGDATABASE || 'fby_test'}_migrate`;
const database = { ...server, database: migrateDatabase };
const usage = /^Usage: filby <validate\|preview> \[directory \.\.\.\]$/m;

describe('Migrate', () => {

  let directory;
  let migrations;

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'filby-migrate-'));
  });

  beforeEach(async () => {
    await execute(server.user, `DROP DATABASE IF EXISTS ${migrateDatabase} WITH (FORCE)`);
    await execute(server.user, `CREATE DATABASE ${migrateDatabase}`);
    migrations = fs.mkdtempSync(path.join(directory, 'migrations-'));
  });

  after(async () => {
    await execute(server.user, `DROP DATABASE IF EXISTS ${migrateDatabase} WITH (FORCE)`);
    fs.rmSync(directory, { recursive: true, force: true });
  });

  describe('init({ migrate: false })', () => {

    it('rejects naming the first Filby migration when the database has never been migrated', async () => {
      writeMigration('001.add-park.sql', addEntity('Park'));

      await rejects(() => withFilby((filby) => filby.init({ migrate: false })), (err) => {
        eq(err.message, "Migration '001.create-fby-entity-relations.sql' in namespace 'filby' has not been applied");
        return true;
      });
      eq(await tableExists('fby_entity'), false);
    });

    it('rejects naming the first pending application migration without applying it', async () => {
      writeMigration('001.add-park.sql', addEntity('Park'));
      await withFilby((filby) => filby.init());
      writeMigration('002.add-season.sql', addEntity('Season'));
      writeMigration('003.add-rate.sql', addEntity('Rate'));

      await rejects(() => withFilby((filby) => filby.init({ migrate: false })), (err) => {
        eq(err.message, "Migration '002.add-season.sql' in namespace 'default' has not been applied");
        return true;
      });
      deq(await getEntityNames(), ['Park']);
    });

    it('starts when every migration has been applied, while another process holds the migration lock', async () => {
      writeMigration('001.add-park.sql', addEntity('Park'));
      await withFilby((filby) => filby.init());

      const holder = new Client(database);
      await holder.connect();
      try {
        await holder.query('SELECT pg_advisory_lock($1)', [Filby.MIGRATION_LOCK_KEY]);
        await withFilby(async (filby) => {
          await filby.init({ migrate: false });
          deq(await filby.getProjections(), []);
        });
      } finally {
        await holder.end();
      }
    });

    it('ignores applied migrations that have no file and migrations that are not audited', async () => {
      writeMigration('001.add-park.sql', addEntity('Park'));
      writeMigration('002.add-season.sql', addEntity('Season'));
      await withFilby((filby) => filby.init());
      fs.rmSync(path.join(migrations, '002.add-season.sql'));

      const unaudited = fs.mkdtempSync(path.join(directory, 'unaudited-'));
      fs.writeFileSync(path.join(unaudited, '.marvrc'), JSON.stringify({ namespace: 'unaudited', directives: { audit: false } }));
      fs.writeFileSync(path.join(unaudited, '001.add-rate.sql'), addEntity('Rate'));

      await withFilby((filby) => filby.init({ migrate: false }), { migrations: [migrations, unaudited] });
      deq(await getEntityNames(), ['Park', 'Season']);
    });
  });

  describe('filby migrate', () => {

    it('applies outstanding migrations and exits', async () => {
      writeMigration('001.add-park.sql', addEntity('Park'));
      const { stdout, stderr } = await run(process.execPath, [cli, 'migrate', '--config', writeConfig()]);
      eq(stdout, '');
      eq(stderr, '');

      writeMigration('002.add-season.sql', addEntity('Season'));
      await run(process.execPath, [cli, 'migrate', '--config', writeConfig()]);

      deq(await getEntityNames(), ['Park', 'Season']);
      await withFilby((filby) => filby.init({ migrate: false }));
    });

    it('exits 1 and reports a migration that fails', async () => {
      writeMigration('001.broken.sql', 'SELECT * FROM wombat;');
      const { code, stderr } = await fails(['migrate', '--config', writeConfig()]);
      eq(code, 1);
      match(stderr, /relation "wombat" does not exist/);
    });

    it('rejects an unreadable config', async () => {
      const { code, stderr } = await fails(['migrate', '--config', path.join(directory, 'missing.json')]);
      eq(code, 1);
      match(stderr, /^Cannot read config '.*missing\.json': ENOENT/m);
    });

    it('rejects a missing --config', async () => {
      const { code, stderr } = await fails(['migrate']);
      eq(code, 1);
      match(stderr, /^Missing option '--config'$/m);
      match(stderr, usage);
    });
  });

  function writeMigration(filename, script) {
    fs.writeFileSync(path.join(migrations, filename), script);
  }

  function writeConfig() {
    const file = path.join(directory, 'filby.json');
    fs.writeFileSync(file, JSON.stringify({ database, migrations: [migrations] }));
    return file;
  }

  async function withFilby(fn, config = {}) {
    const filby = new Filby({ database, migrations: [migrations], ...config });
    try {
      return await fn(filby);
    } finally {
      await filby.stop();
    }
  }

  async function getEntityNames() {
    const { rows } = await execute(migrateDatabase, 'SELECT name FROM fby_entity ORDER BY id');
    return rows.map(({ name }) => name);
  }

  async function tableExists(name) {
    const { rows: [{ exists }] } = await execute(migrateDatabase, 'SELECT to_regclass($1) IS NOT NULL AS exists', [name]);
    return exists;
  }

  async function fails(args) {
    try {
      await run(process.execPath, [cli, ...args]);
    } catch (err) {
      return err;
    }
    throw new Error('Expected the command to fail');
  }
});

function addEntity(name) {
  return `INSERT INTO fby_entity (name, version) VALUES ('${name}', 1);`;
}

async function execute(name, sql, values) {
  const client = new Client({ ...server, database: name });
  await client.connect();
  try {
    return await client.query(sql, values);
  } finally {
    await client.end();
  }
}
