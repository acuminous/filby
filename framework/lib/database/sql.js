import fs from 'node:fs';
import path from 'node:path';

const directory = path.join(import.meta.dirname, 'sql');

const sql = Object.fromEntries(fs.readdirSync(directory).sort().map((group) => [camelCase(group), loadGroup(path.join(directory, group))]));

function loadGroup(groupDirectory) {
  return Object.fromEntries(fs.readdirSync(groupDirectory).filter((filename) => filename.endsWith('.sql')).sort().map((filename) => [camelCase(path.basename(filename, '.sql')), load(path.join(groupDirectory, filename))]));
}

function load(file) {
  return fs.readFileSync(file, 'utf8').trim().replace(/;$/, '');
}

function camelCase(name) {
  return name.replace(/-(\w)/g, (_, letter) => letter.toUpperCase());
}

export { sql };
