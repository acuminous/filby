#!/usr/bin/env node
const path = require('node:path');
const { parseArgs } = require('node:util');
const marv = require('marv/api/promise');

const render = require('../lib/render-migration');
const createValidator = require('../lib/data-validator');

const commands = { validate, preview };

async function main() {
  const { positionals: [command, ...directories] } = parseArgs({ allowPositionals: true });
  if (!commands[command]) {
    process.stderr.write('Usage: filby <validate|preview> [directory ...]\n');
    process.exitCode = 1;
    return;
  }
  const results = await scan(directories.length > 0 ? directories : ['migrations']);
  process.exitCode = commands[command](results) ? 0 : 1;
}

async function scan(directories) {
  const validator = createValidator();
  const results = [];
  for (const directory of directories) {
    results.push(...await scanDirectory(path.resolve(directory), validator));
  }
  return results;
}

async function scanDirectory(directory, validator) {
  try {
    const scanned = await marv.scan(directory, { filter: /\.(ya?ml|json|sql)$/ });
    return scanned
      .sort((a, b) => a.level - b.level)
      .map((migration) => renderMigration({ ...migration, directory, filename: label(path.join(directory, migration.filename)) }, validator));
  } catch (err) {
    return [{ error: describe(label(directory), err) }];
  }
}

function renderMigration(migration, validator) {
  try {
    return { filename: migration.filename, sql: render(migration, validator) };
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
