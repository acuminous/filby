import pg from 'pg';
import Handlebars from 'handlebars';

import { canonicalise, v, table, aggregate, projectionFunction } from '../naming.js';
import { frameChunks } from './frames.js';

const { SafeString } = Handlebars;

function escapeIdentifier(value) {
  return new SafeString(pg.escapeIdentifier(value));
}

function escapeLiteral(value) {
  return new SafeString(pg.escapeLiteral(value));
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

function fieldType(entityName, version, fieldName, type) {
  if (!type.match(/^[a-z_][a-z\d_\s(),.[\]]*$/i)) throw new Error(`Invalid PostgreSQL TYPE '${type}' for field '${fieldName}' of entity '${entityName} ${v(version)}'`);
  const [, base, suffix = ''] = type.match(/^(.*?)(\[\])?$/);
  const enumName = canonicalise(base);
  return new SafeString(`CASE WHEN EXISTS (SELECT 1 FROM fby_enum WHERE name = ${pg.escapeLiteral(enumName)}) THEN ${pg.escapeLiteral(enumName + suffix)} ELSE ${pg.escapeLiteral(type)} END`);
}

function unique(entity) {
  const columnNames = uniqueColumns(entity);
  return new SafeString(`CONSTRAINT ${escapeIdentifier(uniqueName(entity))} UNIQUE (${columnNames.map(escapeIdentifier).join(', ')})`);
}

function uniqueName(entity) {
  return `uniq_${table(entity.name, entity.version)}_${uniqueColumns(entity).join('_')}`;
}

function uniqueColumns(entity) {
  return ['fby_change_set_id'].concat(entity.identified_by.map((column) => canonicalise(column.name)));
}

function frameReference(entity) {
  const constraintName = `fk_${table(entity.name, entity.version)}_fby_data_frame`;
  return new SafeString(`CONSTRAINT ${escapeIdentifier(constraintName)} FOREIGN KEY (fby_frame_id, fby_change_set_id, fby_action) REFERENCES fby_data_frame (id, change_set_id, action) ON DELETE CASCADE`);
}

function check(name, expression) {
  const constraintName = `chk_${name}`;
  return new SafeString(`CONSTRAINT ${escapeIdentifier(constraintName)} CHECK (fby_action = 'DELETE' OR (${expression}))`);
}

function notNull(entity) {
  const fields = entity.fields.filter((field) => !field.nullable && !entity.identified_by.includes(field)).map(({ name }) => canonicalise(name));
  return new SafeString(fields.map((name) => `, CONSTRAINT ${escapeIdentifier(`not_null_${name}`)} CHECK (fby_action = 'DELETE' OR ${escapeIdentifier(name)} IS NOT NULL)`).join(''));
}

function isBareDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function fieldArray(fields, property) {
  if (fields === undefined) return new SafeString('NULL');
  const names = fields.map((item) => item[property]);
  return new SafeString(`ARRAY[${names.map(pg.escapeLiteral).join(', ')}]::TEXT[]`);
}

function nestPath(parent, name) {
  return parent === undefined ? name : `${parent}.${name}`;
}

export {
  and,
  includes,
  ordinal,
  canonical,
  v,
  literal,
  identifier,
  table,
  fieldType,
  unique,
  uniqueName,
  frameReference,
  check,
  notNull,
  aggregate,
  isBareDate,
  frameChunks,
  projectionFunction,
  fieldArray,
  nestPath,
};
