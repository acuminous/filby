const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ok, strictEqual: eq, rejects } = require('node:assert');
const { describe, it, before, beforeEach, afterEach, after, mock } = require('node:test');
const marv = require('marv/api/promise');

const { Filby } = require('..');
const TestFilby = require('./TestFilby');

const database = { user: 'fby_test', password: 'fby_test' };

const RELEASED = {
  1: '2e34107d31fe45d0e3408f667b8c6f8d',
  2: 'f4ca5f186d9402dfacda735999058078',
  3: 'a2580ab72aeab41bd9ead0ec68a7e457',
  4: 'e13b653a8a45ab6c8bb6955d038429cc',
  5: '53577c3681152a5f6c8c3377dfca3150',
  6: '77caf46a2363da07bdc85fd33238dc8b',
  7: '7c7965bca0cc710a716e0bc7911778ed',
  8: 'bc770eb5f4ac9b3a4b12226611616cb0',
};

describe('Checksums', () => {

  let filby;
  let directory;

  before(async () => {
    filby = new TestFilby({});
    await filby.reset();
  });

  beforeEach(async () => {
    await filby.wipe();
    await deleteUserMigrations();
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'filby-'));
    await fs.writeFile(path.join(directory, '.marvrc'), JSON.stringify({ namespace: 'checksums' }));
  });

  afterEach(async () => {
    mock.restoreAll();
    await fs.rm(directory, { recursive: true, force: true });
  });

  after(async () => {
    await filby.wipe();
    await deleteUserMigrations();
    await filby.stop();
  });

  it('should accept the checksums of Filby migrations released in 0.14.0', async () => {
    const migrations = await marv.scan(path.join(__dirname, '..', 'migrations'));
    for (const { level, filename, script, directives } of migrations) {
      const accepted = [md5(script), ...(directives.accept || '').split(',').map((checksum) => checksum.trim())];
      ok(!RELEASED[level] || accepted.includes(RELEASED[level]), `${filename} has changed since 0.14.0 without an ACCEPT directive for ${RELEASED[level]}`);
    }
  });

  it('should reject changes to Filby migrations', async () => {
    const { rows } = await query("SELECT checksum FROM migrations WHERE namespace = 'filby' AND level = 1");
    await query("UPDATE migrations SET checksum = $1 WHERE namespace = 'filby' AND level = 1", [md5('tampered')]);
    try {
      await rejects(() => init(), { message: /Migration 1 from namespace: filby has changed since it was applied/ });
    } finally {
      await query("UPDATE migrations SET checksum = $1 WHERE namespace = 'filby' AND level = 1", [rows[0].checksum]);
    }
  });

  it('should not check user migrations', async () => {
    const filename = path.join(directory, '001.add-checksum.sql');
    await fs.writeFile(filename, "INSERT INTO fby_entity (name, version) VALUES ('Checksum', 1);");
    await init();
    await fs.writeFile(filename, "INSERT INTO fby_entity (name, version) VALUES ('Edited', 1);");
    const warn = mock.method(console, 'warn', () => {});

    await init();

    eq(warn.mock.callCount(), 0);
  });

  async function init() {
    const instance = new Filby({ database, migrations: [directory] });
    try {
      await instance.init();
    } finally {
      await instance.stop();
    }
  }

  async function deleteUserMigrations() {
    await query("DELETE FROM migrations WHERE namespace = 'checksums'");
  }

  async function query(sql, params) {
    return filby.withTransaction((tx) => tx.query(sql, params));
  }
});

function md5(script) {
  return crypto.createHash('md5').update(script, 'utf8').digest('hex');
}
