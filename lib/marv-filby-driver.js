const path = require('node:path');

const YAML = require('yaml');
const marvPgDriver = require('marv-pg-driver');

const compile = require('./compile-template');
const validate = require('./validate-migration');

module.exports = (config) => {
  const pgDriver = marvPgDriver({ connection: config.database });

  function getMigrations(cb) {
    pgDriver.getMigrations((err, migrations) => {
      if (err) return cb(err);
      cb(null, migrations.map(hideUserChecksum));
    });
  }

  function hideUserChecksum(migration) {
    return migration.namespace === 'filby' ? migration : { ...migration, checksum: null };
  }

  function runMigration(migration, cb) {
    const fileType = getFileType(migration);
    switch (fileType) {
      case 'sql': return performSqlMigration(migration, cb);
      case 'json': return performJsonMigration(migration, cb);
      case 'yml':
      case 'yaml': return performYamlMigration(migration, cb);
      default: return cb(new Error(`Unsupported file type: ${fileType}`));
    }
  }

  function getFileType(migration) {
    return path.extname(migration.filename).replace(/^\./, '');
  }

  function performSqlMigration(migration, cb) {
    pgDriver.runMigration(migration, cb);
  }

  function performJsonMigration(migration, cb) {
    prepareMigration(JSON.parse, migration, (err, sqlMigration) => {
      if (err) return cb(err);
      performSqlMigration(sqlMigration, cb);
    });
  }

  function performYamlMigration(migration, cb) {
    prepareMigration(parseYaml, migration, (err, sqlMigration) => {
      if (err) return cb(err);
      performSqlMigration(sqlMigration, cb);
    });
  }

  function parseYaml(script) {
    return YAML.parse(script, { schema: 'core' });
  }

  function prepareMigration(parseFn, migration, cb) {
    let script;
    try {
      script = getSql(parseFn, migration);
    } catch (err) {
      return cb(err);
    }
    cb(null, { ...migration, script });
  }

  function getSql(parseFn, migration) {
    const document = canonicaliseActions(parseFn(migration.script));
    validate(migration.filename, document);
    return renderSql(migration, document.map(normalise));
  }

  function canonicaliseActions(document) {
    if (!Array.isArray(document)) return document;
    document.forEach((instruction) => {
      [].concat(instruction?.changes ?? [], instruction?.frames ?? []).forEach(canonicaliseAction);
    });
    return document;
  }

  function canonicaliseAction(frame) {
    if (frame === null || typeof frame !== 'object') return;
    if (typeof frame.action === 'string') frame.action = frame.action.toUpperCase();
    else if (frame.action === undefined && frame.source === undefined) frame.action = 'SET';
  }

  function normalise(instruction) {
    switch (instruction.operation) {
      case 'ADD_ENTITY': return normaliseEntity(instruction);
      case 'ADD_PROJECTION': return normaliseProjection(instruction);
      case 'ADD_HOOK': return normaliseHook(instruction);
      case 'ADD_CHANGE_SET': return normaliseChangeSet(instruction);
      default: return instruction;
    }
  }

  function normaliseEntity({ version = 1, fields, key, identified_by, ...instruction }) {
    const keyNames = exclusive(`Entity '${instruction.name}'`, { key, identified_by });
    const fieldList = toFieldList(fields).map((field) => ({ ...field, nullable: field.nullable && !keyNames.includes(field.name) }));
    const identityFields = keyNames.map((name) => {
      const field = fieldList.find((f) => f.name === name);
      if (!field) throw new Error(`Identifier '${name}' does not match one of the '${instruction.name}' entity field names`);
      return field;
    });
    return { ...instruction, version, fields: fieldList, identified_by: identityFields };
  }

  function toFieldList(fields) {
    if (Array.isArray(fields)) return fields.map(toField);
    return Object.entries(fields).map(([name, definition]) => toField(typeof definition === 'string' ? { name, type: definition } : { name, ...definition }));
  }

  function toField({ nullable = true, ...field }) {
    return { ...field, nullable };
  }

  function normaliseProjection({ version = 1, dependencies, ...instruction }) {
    return { ...instruction, version, dependencies: dependencies.map((dependency) => normaliseReference('entity', dependency)) };
  }

  function normaliseHook(instruction) {
    return instruction.projection === undefined ? instruction : normaliseReference('projection', instruction);
  }

  function normaliseChangeSet({ changes, frames, ...instruction }) {
    const frameList = exclusive(`Change set '${instruction.description}'`, { changes, frames });
    return { ...instruction, frames: frameList.map((frame) => normaliseReference('entity', frame)) };
  }

  function normaliseReference(property, { [property]: reference, version, ...rest }) {
    const match = /^(.*)@(\d+)$/.exec(reference);
    if (!match) return { ...rest, [property]: reference, version };
    if (version !== undefined) throw new Error(`Reference '${reference}' must not also specify a version`);
    return { ...rest, [property]: match[1], version: Number(match[2]) };
  }

  function exclusive(subject, alternatives) {
    const specified = Object.entries(alternatives).filter(([, value]) => value !== undefined);
    if (specified.length > 1) throw new Error(`${subject} must specify either '${specified[0][0]}' or '${specified[1][0]}', not both`);
    return specified[0][1];
  }

  function renderSql({ filename, directory }, script) {
    const data = { filename, directory };
    const render = compile(__dirname, 'template.hbs');
    return render(script, { data });
  }

  return { ...pgDriver, getMigrations, runMigration };
};
