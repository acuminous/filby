const fs = require('node:fs');
const path = require('node:path');
const pg = require('pg');
const { partials, SafeString } = require('handlebars');
const Papa = require('papaparse');

function escapeIdentifier(value) {
  return new SafeString(pg.escapeIdentifier(value));
}

function escapeLiteral(value) {
  return new SafeString(pg.escapeLiteral(value));
}

function partial(operation, options) {
  const { filename, directory } = options.data;
  const template = partials[operation.toLowerCase()];
  return new SafeString(template(this, { data: { filename, directory } }));
}

function eq(a, b) {
  return a === b;
}

function and(...args) {
  return args.every(Boolean);
}

function includes(items, item) {
  return items.includes(item);
}

function ordinal(options) {
  return options.data.index + 1;
}

function v(version) {
  return `v${version}`;
}

function canonicalise(...args) {
  return args.join(' ').toLowerCase().replace(/\s/g, '_');
}

function canonical(text) {
  return canonicalise(text);
}

function literal(...args) {
  args.pop(); // Discard handlebars options
  return (args.length === 1 && args[0] === undefined)
    ? new SafeString(null)
    : escapeLiteral(args.join(' '));
}

function identifier(...args) {
  args.pop(); // Discard handlebars options
  return escapeIdentifier(canonicalise(...args));
}

function table(name, version) {
  return canonicalise(name, v(version));
}

function validateType(text) {
  if (!text.match(/^[a-z\s_()\d]+$/i)) throw new Error(`Invalid PostgreSQL TYPE '${text}'`);
  return new SafeString(text);
}

function unique(entity) {
  const tableName = table(entity.name, entity.version);
  const columnNames = ['fby_change_set_id'].concat(entity.identified_by.map((column) => canonicalise(column.name)));
  const constraintName = `uniq_${tableName}_${columnNames.join('_')}`;
  return new SafeString(`CONSTRAINT ${escapeIdentifier(constraintName)} UNIQUE (${columnNames.map(escapeIdentifier).join(', ')})`);
}

function frameReference(entity) {
  const constraintName = `fk_${table(entity.name, entity.version)}_fby_data_frame`;
  return new SafeString(`CONSTRAINT ${escapeIdentifier(constraintName)} FOREIGN KEY (fby_frame_id, fby_change_set_id) REFERENCES fby_data_frame (id, change_set_id) ON DELETE CASCADE`);
}

function check(name, expression) {
  const constraintName = `chk_${name}`;
  return new SafeString(`CONSTRAINT ${escapeIdentifier(constraintName)} CHECK ${expression}`);
}

function json(data) {
  const canonicalData = Object.fromEntries(Object.entries(data).map(([key, value]) => [canonicalise(key), value]));
  return JSON.stringify(canonicalData);
}

function aggregate(name, version) {
  return `get_${table(name, version)}_aggregate`;
}

function frameAction(action) {
  return action === 'POST' ? 'SET' : action;
}

function loadCsv(source, options) {
  const csvPath = path.resolve(options.data.directory, source);
  const { rows, errors } = parseCsv(csvPath);
  if (errors[0]) throw new Error(`Error parsing ${csvPath}:${errors[0].row + 2} - ${errors[0].message}`);
  const frames = rows.map((row) => {
    const data = Object.keys(row)
      .filter((key) => key !== 'action')
      .filter((key) => row[key] !== null)
      .reduce((obj, key) => {
        return { ...obj, [key]: row[key] };
      }, {});
    return { action: row.action, data };
  });

  return frames.reduce((output, frame) => {
    return output + options.fn(frame);
  }, '');
}

function parseCsv(csvPath) {
  const source = fs.readFileSync(csvPath, 'utf8');
  const { data: rows, errors } = Papa.parse(source, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });
  return { rows, errors };
}

function xkeys(obj, options) {
  return Object.keys(obj).reduce(appendBlock.bind(options), '');
}

function xvalues(obj, options) {
  return Object.values(obj).reduce(appendBlock.bind(options), '');
}

function appendBlock(result, item, index, items) {
  const context = { item, isLast: index === items.length - 1 };
  return result + this.fn(context);
}

module.exports = {
  partial,
  eq,
  and,
  includes,
  ordinal,
  canonical,
  v,
  literal,
  identifier,
  table,
  validateType,
  unique,
  frameReference,
  json,
  check,
  aggregate,
  frameAction,
  loadCsv,
  xkeys,
  xvalues,
};
