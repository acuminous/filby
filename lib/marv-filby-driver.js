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
    if (!isSupportedFileType(fileType)) return cb(new Error(`Unsupported file type: ${migration.filename}`));

    if (fileType === 'sql') return pgDriver.runMigration(migration, cb);

    const script = parseMigrationScript(migration, fileType);

    try {
      validate(migration.filename, script);
      completeIdentityFields(script);
      const sql = renderSql(script);
      pgDriver.runMigration({ ...migration, script: sql }, cb);
    } catch (err) {
      return cb(err);
    }
  }

  function getFileType(migration) {
    return path.extname(migration.filename).replace(/^\./, '');
  }

  function isSupportedFileType(fileType) {
    return ['sql', 'yaml', 'json'].includes(fileType);
  }

  function parseMigrationScript(migration, fileType) {
    if (fileType === 'yaml') return YAML.parse(migration.script);
    if (fileType === 'json') return JSON.parse(migration.script);
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
