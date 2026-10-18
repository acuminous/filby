const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const YAML = require('yaml');

const parsers = {
  '.json': JSON.parse,
  '.yaml': YAML.parse,
  '.yml': YAML.parse,
};

module.exports = async ({ filename, directory, script }) => {
  const parse = parsers[path.extname(filename)];
  const hash = crypto.createHash('sha256').update(script);
  for (const source of getSources(parse(script))) {
    const content = await readSource(path.resolve(directory, source));
    hash.update(`\0${source}\0${content}`);
  }
  return `filby-v2:${hash.digest('hex')}`;
};

function getSources(document) {
  if (!Array.isArray(document)) return [];
  return document
    .filter((instruction) => instruction?.operation === 'ADD_CHANGE_SET')
    .flatMap((instruction) => instruction.frames || [])
    .map((frame) => frame?.source)
    .filter(Boolean);
}

async function readSource(csvPath) {
  try {
    return await fs.readFile(csvPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return '';
    throw err;
  }
}
