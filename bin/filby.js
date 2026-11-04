#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs } = require('node:util');
const marv = require('marv/api/promise');

const { Filby } = require('..');
const render = require('../lib/render-migration');
const exportBundle = require('../lib/export');

const USAGE = [
  'Usage: filby <validate|preview> [directory ...]',
  '       filby export --config <file> --projection <name@version> --out <file>',
].join('\n');

const commands = {
  validate: (args) => check(args, validate),
  preview: (args) => check(args, preview),
  export: exportCommand,
};

class UsageError extends Error {}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!Object.hasOwn(commands, command)) {
    process.stderr.write(`${USAGE}\n`);
    process.exitCode = 1;
    return;
  }
  try {
    process.exitCode = (await commands[command](args)) ? 0 : 1;
  } catch (err) {
    process.stderr.write(err instanceof UsageError ? `${err.message}\n${USAGE}\n` : `${err.message}\n`);
    process.exitCode = 1;
  }
}

async function check(args, command) {
  const { positionals: directories } = parseOptions(args, { allowPositionals: true });
  const results = await scan(directories.length > 0 ? directories : ['migrations']);
  return command(results);
}

async function exportCommand(args) {
  const { config: configFile, projection: reference, out } = requiredOptions(args, ['config', 'projection', 'out']);
  const [, name, version] = reference.match(/^(.+)@(\d+)$/) ?? [];
  if (!name) throw new UsageError(`Projection '${reference}' must be given as name@version`);
  const filby = new Filby(readJson(configFile, 'config'));
  try {
    await filby.init();
    const bundle = await exportBundle(filby, name, Number(version));
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(bundle, null, 2)}\n`);
  } finally {
    await filby.stop();
  }
  return true;
}

function parseOptions(args, config) {
  try {
    return parseArgs({ args, ...config });
  } catch (err) {
    throw new UsageError(err.message);
  }
}

function requiredOptions(args, names) {
  const { values } = parseOptions(args, { options: Object.fromEntries(names.map((name) => [name, { type: 'string' }])) });
  const missing = names.find((name) => values[name] === undefined);
  if (missing) throw new UsageError(`Missing option '--${missing}'`);
  return values;
}

function readJson(file, description) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot read ${description} '${file}': ${err.message}`);
  }
}

async function scan(directories) {
  const results = [];
  for (const directory of directories) {
    results.push(...await scanDirectory(path.resolve(directory)));
  }
  return results;
}

async function scanDirectory(directory) {
  try {
    const scanned = await marv.scan(directory, { filter: /\.(ya?ml|json|sql)$/ });
    return scanned
      .sort((a, b) => a.level - b.level)
      .map((migration) => renderMigration({ ...migration, directory, filename: label(path.join(directory, migration.filename)) }));
  } catch (err) {
    return [{ error: describe(label(directory), err) }];
  }
}

function renderMigration(migration) {
  try {
    return { filename: migration.filename, sql: render(migration) };
  } catch (err) {
    return { error: describe(migration.filename, err) };
  }
}

function label(fullPath) {
  return path.relative(process.cwd(), fullPath);
}

function describe(filename, err) {
  return err.message.startsWith(`${filename}: `) ? err.message : `${filename}: ${err.message}`;
}

function validate(results) {
  const errors = results.filter((result) => result.error);
  for (const result of errors) process.stderr.write(`${result.error}\n`);
  return errors.length === 0;
}

function preview(results) {
  if (!validate(results)) return false;
  for (const result of results) process.stdout.write(`-- ${result.filename}\n${result.sql}\n`);
  return true;
}

main();
