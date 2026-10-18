const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ok, strictEqual: eq, notStrictEqual: neq, match, rejects } = require('node:assert');
const { describe, it, before, beforeEach, afterEach, after, mock } = require('node:test');

const { Filby } = require('..');
const TestFilby = require('./TestFilby');
const checksum = require('../lib/checksum');

const database = { user: 'fby_test', password: 'fby_test' };
const modes = ['ignore', 'warn', 'error'];

const MIGRATION = [
  '- operation: ADD_ENTITY',
  '  name: Checksum',
  '  version: 1',
  '  fields:',
  '    - name: type',
  '      type: TEXT',
  '  identified_by:',
  '    - type',
  '- operation: ADD_CHANGE_SET',
  '  description: Checksum data',
  '  effective: 2020-04-05T00:00:00.000Z',
  '  frames:',
  '    - entity: Checksum',
  '      version: 1',
  '      source: ./csv/types.csv',
].join('\n');

const CSV = 'action,type\nPOST,standard\n';

describe('Checksums', () => {

  const directories = [];

  after(async () => {
    await Promise.all(directories.map((directory) => fs.rm(directory, { recursive: true, force: true })));
  });

  describe('Checksum', () => {

    it('should use the filby-v2 form for migrations without csv sources', async () => {
      const directory = await createDirectory({});
      const actual = await checksum({ filename: '001.no-csv.yaml', directory, script: '- operation: ADD_ENUM' });
      match(actual, /^filby-v2:[0-9a-f]{64}$/);
    });

    it('should be stable', async () => {
      const directory = await createMigrationDirectory();
      const migration = { filename: '001.add-checksum.yaml', directory, script: MIGRATION };
      eq(await checksum(migration), await checksum(migration));
    });

    it('should cover the content of referenced csv files', async () => {
      const first = await createMigrationDirectory();
      const second = await createMigrationDirectory('action,type\nPOST,premium\n');
      const firstChecksum = await checksum({ filename: '001.add-checksum.yaml', directory: first, script: MIGRATION });
      const secondChecksum = await checksum({ filename: '001.add-checksum.yaml', directory: second, script: MIGRATION });
      neq(firstChecksum, secondChecksum);
    });

    it('should cover json migrations', async () => {
      const directory = await createMigrationDirectory();
      const script = JSON.stringify([{ operation: 'ADD_CHANGE_SET', frames: [{ source: './csv/types.csv' }] }]);
      const before = await checksum({ filename: '001.add-checksum.json', directory, script });
      await fs.writeFile(path.join(directory, 'csv', 'types.csv'), 'action,type\nPOST,premium\n');
      neq(await checksum({ filename: '001.add-checksum.json', directory, script }), before);
    });

    it('should change when a referenced csv file is missing', async () => {
      const directory = await createMigrationDirectory();
      const migration = { filename: '001.add-checksum.yaml', directory, script: MIGRATION };
      const before = await checksum(migration);
      await fs.rm(path.join(directory, 'csv'), { recursive: true });
      neq(await checksum(migration), before);
    });
  });

  describe('Validation', () => {

    let filby;
    let directory;

    before(async () => {
      filby = new TestFilby({ nukeCustomObjects });
      await filby.reset();
    });

    beforeEach(async () => {
      await filby.wipe();
      await deleteMigrationRows();
      directory = await createMigrationDirectory();
    });

    afterEach(() => {
      mock.restoreAll();
    });

    after(async () => {
      await filby.wipe();
      await deleteMigrationRows();
      await filby.stop();
    });

    it('should record filby-v2 checksums for new yaml migrations', async () => {
      await init('error');
      const expected = await checksum({ filename: '001.add-checksum.yaml', directory, script: MIGRATION });
      eq(await getStoredChecksum(), expected);
    });

    for (const mode of modes) {
      it(`should baseline legacy checksums that match the current migration under ${mode}`, async () => {
        await init('error');
        await setStoredChecksum(md5(MIGRATION));

        await init(mode);

        match(await getStoredChecksum(), /^filby-v2:/);
      });
    }

    it('should report legacy checksums that do not match the current migration', async () => {
      await init('error');
      await setStoredChecksum(md5('something else'));

      await rejects(() => init('error'), { message: /Migration 1 from namespace: checksums has changed since it was applied/ });
      eq(await getStoredChecksum(), md5('something else'));
    });

    describe('After editing an applied yaml migration', () => {

      beforeEach(async () => {
        await init('error');
        await fs.writeFile(path.join(directory, '001.add-checksum.yaml'), MIGRATION.replace('Checksum data', 'Edited data'));
      });

      checkModes();
    });

    describe('After editing a referenced csv file', () => {

      beforeEach(async () => {
        await init('error');
        await fs.writeFile(path.join(directory, 'csv', 'types.csv'), 'action,type\nPOST,premium\n');
      });

      checkModes();
    });

    it('should report changes to Filby migrations', async () => {
      const original = await getStoredChecksum('filby');
      await setStoredChecksum(md5('tampered'), 'filby');
      try {
        await rejects(() => init('error'), { message: /Migration 1 from namespace: filby has changed since it was applied/ });
      } finally {
        await setStoredChecksum(original, 'filby');
      }
    });

    function checkModes() {
      it('should reject under error', async () => {
        await rejects(() => init('error'), { message: /Migration 1 from namespace: checksums has changed since it was applied/ });
      });

      it('should warn and continue under warn', async () => {
        const warn = mock.method(console, 'warn', () => {});
        await init('warn');
        eq(warn.mock.callCount(), 1);
        match(warn.mock.calls[0].arguments[0], /Migration 1 from namespace: checksums has changed since it was applied/);
      });

      it('should be silent under ignore', async () => {
        const warn = mock.method(console, 'warn', () => {});
        await init('ignore');
        eq(warn.mock.callCount(), 0);
      });
    }

    async function init(checksums) {
      const instance = new Filby({ database, migrations: [directory], checksums });
      try {
        await instance.init();
      } finally {
        await instance.stop();
      }
    }

    async function getStoredChecksum(namespace = 'checksums') {
      const { rows } = await filby.withTransaction((tx) => tx.query('SELECT checksum FROM migrations WHERE namespace = $1 AND level = 1', [namespace]));
      ok(rows[0]);
      return rows[0].checksum;
    }

    async function setStoredChecksum(value, namespace = 'checksums') {
      await filby.withTransaction((tx) => tx.query('UPDATE migrations SET checksum = $1 WHERE namespace = $2 AND level = 1', [value, namespace]));
    }

    async function deleteMigrationRows() {
      await filby.withTransaction((tx) => tx.query("DELETE FROM migrations WHERE namespace = 'checksums'"));
    }
  });

  async function createMigrationDirectory(csv = CSV) {
    const directory = await createDirectory({
      '.marvrc': JSON.stringify({ namespace: 'checksums' }),
      '001.add-checksum.yaml': MIGRATION,
    });
    await writeFiles(path.join(directory, 'csv'), { 'types.csv': csv });
    return directory;
  }

  async function createDirectory(files) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'filby-'));
    directories.push(directory);
    await writeFiles(directory, files);
    return directory;
  }
});

async function nukeCustomObjects(tx) {
  await tx.query('DROP TABLE IF EXISTS checksum_v1');
  await tx.query('DROP FUNCTION IF EXISTS get_checksum_v1_aggregate');
}

async function writeFiles(directory, files) {
  await fs.mkdir(directory, { recursive: true });
  await Promise.all(Object.entries(files).map(([filename, content]) => fs.writeFile(path.join(directory, filename), content)));
}

function md5(script) {
  return crypto.createHash('md5').update(script, 'utf8').digest('hex');
}
