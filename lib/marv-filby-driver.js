const fs = require('node:fs');
const path = require('node:path');

const Ajv = require('ajv');
const ajvFormats = require('ajv-formats');
const YAML = require('yaml');
const Handlebars = require('handlebars');
const marvPgDriver = require('marv-pg-driver');

Handlebars.Utils.escapeExpression = function escapeExpression(expression) {
  if (typeof expression === 'string') throw new Error(`Unescaped expression '${expression}' in Handlebars template`);
  return expression;
};

const schema = require('./schema.json');
const proxy = require('./proxy');
const helpers = require('./helpers');
const ajvHumaniseErrors = require('./ajv-humanise-errors');

const partials = [
  'ADD_ENUM',
  'ADD_ENTITY',
  'ADD_PROJECTION',
  'ADD_HOOK',
  'ADD_CHANGE_SET',
  'DROP_ENUM',
  'DROP_ENTITY',
  'DROP_PROJECTION',
  'DROP_HOOK',
  'INSERT_DATA_FRAME',
];

partials.forEach((name) => {
  const filename = name.toLowerCase().replace(/_/g, '-').concat('.hbs');
  const template = compileTemplate(filename, 'partials');
  Handlebars.registerPartial(name, template);
});

const template = compileTemplate('template.hbs');
const ajv = new Ajv();
ajvFormats(ajv);
const validate = ajv.compile(schema);

Handlebars.registerHelper(helpers);

function compileTemplate(filename, folder = '') {
  const fullPath = path.join(__dirname, folder, filename);
  const source = fs.readFileSync(fullPath, 'utf-8');
  return Handlebars.compile(source, { noEscape: false });
}

module.exports = (config) => {
  const pgDriver = marvPgDriver({ connection: config.database });

  function runMigration(migration, cb) {
    const fileType = getFileType(migration);
    if (!isSupportedFileType(fileType)) return cb(new Error(`Unsupported file type: ${migration.filename}`));

    if (fileType === 'sql') return pgDriver.runMigration(migration, cb);

    const script = parseMigrationScript(migration, fileType);

    if (!validate(script)) return cb(createValidationError(migration.filename, validate.errors));
    try {
      completeIdentityFields(script);
    } catch (err) {
      return cb(err);
    }

    const { sql, err } = renderSql(script);
    if (err) return cb(err);
    pgDriver.runMigration({ ...migration, script: sql }, cb);
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

  function createValidationError(filename, errors) {
    const message = ajvHumaniseErrors(filename, errors);
    return Object.assign(new Error(message, { details: errors }));
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
    let sql;
    let err;
    try {
      const data = { dsl: config.dsl };
      sql = template(script, { data });
    } catch (renderErr) {
      err = renderErr;
    }
    return { sql, err };
  }

  return proxy({ runMigration }, pgDriver);
};
