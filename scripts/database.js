const { execSync } = require('node:child_process');
const path = require('node:path');
const { Client } = require('pg');

require('./load-env');

const servers = [
  { port: 5432, user: 'fby_test', password: 'fby_test' },
  { port: 5433, user: 'fby_example', password: 'fby_example' },
  { port: 5434, user: 'fby_example', password: 'fby_example' },
];

const commands = { check, create, drop };

const [command] = process.argv.slice(2);
if (!commands[command]) fail(`Usage: node scripts/database.js ${Object.keys(commands).join('|')}`);

commands[command]().catch((err) => fail(err.message));

async function check() {
  if (isLinkedWorktree() && !process.env.PGDATABASE) {
    fail('This is a linked worktree but PGDATABASE is not set. Add PGDATABASE=fby_<branch> to .env in the worktree root and run npm run db:create. See CLAUDE.md.');
  }
}

async function create() {
  await forEachServer(async (client, database) => {
    const { rowCount } = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
    if (rowCount === 0) await client.query(`CREATE DATABASE ${database}`);
  });
}

async function drop() {
  await forEachServer(async (client, database) => {
    await client.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
    await client.query(`DROP DATABASE IF EXISTS ${database}_upgrade WITH (FORCE)`);
  });
}

async function forEachServer(fn) {
  const database = requireDatabaseName();
  for (const server of servers) {
    const client = new Client({ ...server, database: server.user });
    await client.connect();
    try {
      await fn(client, database);
      console.log(`${command}: ${database} on port ${server.port}`);
    } finally {
      await client.end();
    }
  }
}

function requireDatabaseName() {
  const database = process.env.PGDATABASE;
  if (!database) fail('PGDATABASE is not set. Add PGDATABASE=fby_<branch> to .env in the worktree root.');
  if (!/^[a-z][a-z0-9_]*$/.test(database)) fail(`PGDATABASE '${database}' must contain only lower case letters, digits and underscores`);
  if (['fby_test', 'fby_example'].includes(database)) fail(`PGDATABASE '${database}' is the shared default database and cannot be created or dropped`);
  return database;
}

function isLinkedWorktree() {
  const gitDir = path.resolve(execSync('git rev-parse --git-dir', { encoding: 'utf-8' }).trim());
  const gitCommonDir = path.resolve(execSync('git rev-parse --git-common-dir', { encoding: 'utf-8' }).trim());
  return gitDir !== gitCommonDir;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
