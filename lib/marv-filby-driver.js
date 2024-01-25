const path = require('node:path');

const YAML = require('yaml');
const marvPgDriver = require('marv-pg-driver');

const proxy = require('./proxy');
const sqlTemplate = require('./sql-template');
const validate = require('./validate-migration');

module.exports = (config) => {
  const pgDriver = marvPgDriver({ connection: config.database });

  function runMigration(migration, cb) {
    const fileType = getFileType(migration);
    switch (fileType) {
      case 'sql': return performSqlMigration(migration, cb);
      case 'json': return performJsonMigration(migration, cb);
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
    prepareMigration(YAML.parse, migration, (err, sqlMigration) => {
      if (err) return cb(err);
      performSqlMigration(sqlMigration, cb);
    });
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
    const document = parseFn(migration.script);
    validate(migration.filename, document);
    completeIdentityFields(document);
    return renderSql(document);
  }

  function completeIdentityFields(script) {
    script.forEach((instruction) => {
      if (instruction.operation !== 'ADD_ENTITY') return instruction;
      const identityFields = instruction.identified_by.map((fieldName) => {
        const field = instruction.fields.find((f) => f.name === fieldName);
        if (!field) throw new Error(`Identifier '${fieldName}' does not match one of the '${instruction.name}' entity field names`);
        return field;
      });
      // eslint-disable-next-line no-param-reassign
      instruction.identified_by = identityFields;
    });
  }

  function renderSql(script) {
    const data = { dsl: config.dsl };
    return sqlTemplate(script, { data });
  }

  return proxy({ runMigration }, pgDriver);
};
