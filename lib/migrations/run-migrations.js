import path from 'node:path';

import marv from 'marv/api/promise.js';

import { marvFilbyDriver } from './marv-filby-driver.js';
import { sql } from '../database/sql.js';

const MIGRATION_LOCK_KEY = 102105108098121;

async function scanMigrations(config) {
  const filbyDirectory = path.join(import.meta.dirname, '..', '..', 'migrations');
  const migrationDirectories = config.migrations || ['migrations'];
  const directories = new Set([filbyDirectory, ...migrationDirectories.map((directory) => path.resolve(directory))]);
  const migrations = await Promise.all([...directories].map(async (directory) => {
    const scanned = await marv.scan(directory, { filter: /\.(ya?ml|json|sql)$/ });
    return scanned.map((migration) => ({ ...migration, directory })).sort((a, b) => a.level - b.level);
  }));
  return migrations.flat();
}

async function runMigrations(client, migrations, config) {
  try {
    await client.query(sql.migrations.lock, [MIGRATION_LOCK_KEY]);
    await marv.migrate(migrations, marvFilbyDriver(config), { checksums: 'error' });
  } finally {
    await client.query(sql.migrations.unlock, [MIGRATION_LOCK_KEY]).catch(noop);
    await client.query(sql.notifications.wake).catch(noop);
  }
}

async function checkMigrations(client, migrations) {
  const { rows: [{ recorded }] } = await client.query(sql.migrations.checkRecorded);
  const { rows: applied } = recorded ? await client.query(sql.migrations.listApplied) : { rows: [] };
  const pending = migrations.filter(audited).find((migration) => {
    const namespace = migration.namespace ?? 'default';
    return !applied.some((row) => row.namespace === namespace && row.level === migration.level);
  });
  if (pending) throw new Error(`Migration '${pending.filename}' in namespace '${pending.namespace ?? 'default'}' has not been applied`);
}

function audited({ directives }) {
  return !/^false$/i.test(directives?.audit) && !/^true$/i.test(directives?.skip);
}

function noop() {}

export { MIGRATION_LOCK_KEY, scanMigrations, runMigrations, checkMigrations };
