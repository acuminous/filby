const fs = require('node:fs');
const path = require('node:path');

const Ajv = require('ajv');
const ajvFormats = require('ajv-formats');
const YAML = require('yaml');
const Handlebars = require('handlebars');
const marvPgDriver = require('marv-pg-driver');

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
  return Handlebars.compile(source, { noEscape: true });
}

module.exports = (options) => {
  const pgDriver = marvPgDriver(options);

  function runMigration(migration, cb) {
    const fileType = getFileType(migration);
    if (!isSupportedFileType(fileType)) return cb(new Error(`Unsupported file type: ${migration.filename}`));

    if (fileType === 'sql') return pgDriver.runMigration(migration, cb);

    const script = parseMigrationScript(migration, fileType);

    if (!validate(script)) return cb(createValidationError(migration.filename, validate.errors));

    const { sql, err } = renderSql(decorate(script));
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

  function decorate(script) {
    return script.map((instruction) => {
      if (instruction.operation !== 'ADD_ENTITY') return instruction;
      return {
        ...instruction,
        identified_by: instruction.fields.filter((field) => instruction.identified_by.includes(field.name)),
      };
    });
  }

  function renderSql(script) {
    let sql;
    let err;
    try {
      sql = template(script);
    } catch (renderErr) {
      err = renderErr;
    }
    return { sql, err };
  }

  return proxy({ runMigration }, pgDriver);
};
