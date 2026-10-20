const fs = require('node:fs');
const path = require('node:path');
const pg = require('pg');
const { SafeString } = require('handlebars');
const Papa = require('papaparse');

const CHUNK_SIZE = 1000;

function escapeIdentifier(value) {
  return new SafeString(pg.escapeIdentifier(value));
}

function escapeLiteral(value) {
  return new SafeString(pg.escapeLiteral(value));
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
  if (args.length === 1 && (args[0] === undefined || args[0] === null)) return new SafeString('NULL');
  if (args.length === 1 && typeof args[0] === 'object') return escapeLiteral(JSON.stringify(args[0]));
  return escapeLiteral(args.join(' '));
}

function identifier(...args) {
  args.pop(); // Discard handlebars options
  return escapeIdentifier(canonicalise(...args));
}

function table(name, version) {
  return canonicalise(name, v(version));
}

function validateType(entityName, version, fieldName, type) {
  if (!type.match(/^[a-z_][a-z\d_\s(),.[\]]*$/i)) throw new Error(`Invalid PostgreSQL TYPE '${type}' for field '${fieldName}' of entity '${entityName} ${v(version)}'`);
  return new SafeString(type);
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
  const canonicalAction = action.toUpperCase();
  return canonicalAction === 'POST' ? 'SET' : canonicalAction;
}

function isBareDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function frameChunks(frame, options) {
  const rows = frame.source ? loadCsv(frame, options) : frame.data.map((data) => ({ action: frame.action, data }));
  const canonicalRows = rows.map(({ action, data }) => ({ action: frameAction(action), data: canonicalKeys(data) }));
  const chunks = [];
  for (let i = 0; i < canonicalRows.length; i += CHUNK_SIZE) chunks.push(canonicalRows.slice(i, i + CHUNK_SIZE));
  return chunks.map((chunkRows) => ({ fields: [...new Set(chunkRows.flatMap(({ data }) => Object.keys(data)))], rows: chunkRows }));
}

function canonicalKeys(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [canonicalise(key), value]));
}

function loadCsv(frame, options) {
  const csvPath = path.resolve(options.data.directory, frame.source);
  const { rows, fields, errors } = parseCsv(csvPath);
  if (errors[0]) throw new Error(`Error parsing ${csvPath}:${errors[0].row + 2} - ${errors[0].message}`);
  const hasActionColumn = fields.includes('action');
  if (frame.action !== undefined && hasActionColumn) throw new Error(`Frame for entity '${frame.entity} ${v(frame.version)}' specifies action '${frame.action}' but ${csvPath} also has an action column`);
  if (frame.action === undefined && !hasActionColumn) throw new Error(`Frame for entity '${frame.entity} ${v(frame.version)}' does not specify an action and ${csvPath} has no action column`);
  return rows.map(({ action, ...data }, index) => {
    if (frame.action === undefined && action === null) throw new Error(`Error parsing ${csvPath}:${index + 2} - Missing action`);
    return { action: frame.action ?? action, data };
  });
}

function parseCsv(csvPath) {
  const source = fs.readFileSync(csvPath, 'utf8');
  const { data: rows, meta, errors } = Papa.parse(source, {
    header: true,
    delimiter: ',',
    dynamicTyping: false,
    skipEmptyLines: true,
    transform: (value) => (value === '' ? null : value),
  });
  return { rows, fields: meta.fields, errors };
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

function projectionFunction(name, version) {
  return `get_${table(name, version)}`;
}

function projectionArguments({ name, match }) {
  const argument = `p_${canonicalise(name)}`;
  if (match === 'range') return [{ name: `${argument}_from`, array: false }, { name: `${argument}_to`, array: false }];
  return [{ name: argument, array: match === 'in' }];
}

function projectionPredicates(parameters) {
  if (parameters.length === 0) return 'TRUE';
  let position = 1;
  return parameters.map((parameter) => {
    const column = `a.${pg.escapeIdentifier(canonicalise(parameter.field))}`;
    const positions = projectionArguments(parameter).map(() => `$${++position}`);
    switch (parameter.match) {
      case 'prefix': return `(${positions[0]} IS NULL OR starts_with(${column}, ${positions[0]}))`;
      case 'in': return `(${positions[0]} IS NULL OR ${column} = ANY(${positions[0]}))`;
      case 'range': return `(${positions[0]} IS NULL OR ${column} >= ${positions[0]}) AND (${positions[1]} IS NULL OR ${column} <= ${positions[1]})`;
      default: return `(${positions[0]} IS NULL OR ${column} = ${positions[0]})`;
    }
  }).join(' AND ');
}

function projectionOrder(order) {
  return order.map(({ field, direction, nulls }) => `a.${pg.escapeIdentifier(canonicalise(field))} ${direction}${nulls ? ` NULLS ${nulls}` : ''}`).join(', ');
}

function projectionLimit(parameters, paging) {
  const offset = parameters.flatMap(projectionArguments).length + 2;
  return ` LIMIT LEAST($${offset + 1}, ${paging.page_max}) OFFSET $${offset}`;
}

module.exports = {
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
  isBareDate,
  frameChunks,
  xkeys,
  xvalues,
  projectionFunction,
  projectionArguments,
  projectionPredicates,
  projectionOrder,
  projectionLimit,
};
