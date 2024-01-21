const fs = require('node:fs');
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
  const data = { dsl: options.data.dsl };
  const template = partials[operation];
  return new SafeString(template(this, { data }));
}

function eq(a, b) {
  return a === b;
}

function and(...args) {
  return args.every(Boolean);
}

function v(version) {
  return `v${version}`;
}

function canonicalise(...args) {
  return args.join(' ').toLowerCase().replace(/\s/g, '_');
}

function literal(...args) {
  args.pop(); // Discard handlebars options
  return escapeLiteral(args.join(' '));
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
  const columnNames = ['fby_frame_id'].concat(entity.identified_by.map((column) => canonicalise(column.name)));
  const constraintName = `uniq_${tableName}_${columnNames.join('_')}`;
  return new SafeString(`CONSTRAINT ${escapeIdentifier(constraintName)} UNIQUE (${columnNames.map(escapeIdentifier).join(', ')})`);
}

function check(name, expression, options) {
  if (!options.data?.dsl?.enableCheckConstraints) throw new Error('Check constraints must be explicity enabled in the Filby config due to risk of SQL Injection');
  const constraintName = `chk_${name}`;
  return new SafeString(`CONSTRAINT ${escapeIdentifier(constraintName)} CHECK ${expression}`);
}

function aggregate(name, version) {
  return `get_${table(name, version)}_aggregate`;
}

function loadCsv(path, options) {
  const { rows, errors } = parseCsv(path);
  if (errors[0]) throw new Error(`Error parsing ${path}:${errors[0].row + 2} - ${errors[0].message}`);
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

function parseCsv(path) {
  const source = fs.readFileSync(path, 'utf8');
  const { data: rows, errors } = Papa.parse(source, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });
  return { rows, errors };
}

function xkeys(obj, options) {
  return Object.keys(obj).reduce(toString.bind(options), '');
}

function xvalues(obj, options) {
  return Object.values(obj).reduce(toString.bind(options), '');
}

function toString(result, item, index, items) {
  const context = { item, isLast: index === items.length - 1 };
  return result + this.fn(context);
}

module.exports = {
  partial,
  eq,
  and,
  canonicalise,
  v,
  literal,
  identifier,
  table,
  validateType,
  unique,
  check,
  aggregate,
  loadCsv,
  xkeys,
  xvalues,
};
