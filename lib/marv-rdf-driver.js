const fs = require('node:fs');
const path = require('node:path');

const Ajv = require('ajv');
const addFormats = require("ajv-formats")
const YAML = require('yaml');
const Handlebars = require('handlebars');
const marvPgDriver = require('marv-pg-driver');

const schema = require('./schema');
const proxy = require('./proxy');
const helpers = require('./helpers');

const template = fs.readFileSync(path.join(__dirname, 'template.hbs'), 'utf-8');
const render = Handlebars.compile(template);
const ajv = new Ajv();
addFormats(ajv);
const validate = ajv.compile(schema);

Handlebars.registerHelper(helpers);

module.exports = (options) => {

  const pgDriver = marvPgDriver(options);

  function runMigration(migration, cb) {
    const fileType = getFileType(migration);
    if (fileType === 'sql') return pgDriver.runMigration(migration, cb);

    const script = parseMigrationScript(migration, fileType);
    if (!validate(script)) throw createValidationError(validate);

    decorateMigrationScript(script);

    const sql = render(script)
    pgDriver.runMigration({ ...migration, script: sql }, cb);
  }

  function getFileType(migration) {
    const fileType = path.extname(migration.filename).replace(/^\./, '');
    if (!['sql', 'yaml', 'json'].includes(fileType)) throw new Error(`Unsupported file type: ${fileType}`);
    return fileType;
  }

  function parseMigrationScript(migration, fileType) {
    if (fileType === 'yaml') return YAML.parse(migration.script, reviver);
    else if (fileType === 'json') return JSON.parse(migration.script, reviver);
  }

  function reviver(key, value) {
    if (/\s/.test(key)) {
      this[key.replace(/\s/g, '_')] = value;
      return;
    } else {
      return value;
    }
  };

  function createValidationError(validate) {
    let message;
    const errors = validate.errors.filter((e => e.keyword !== 'oneOf'));
    const instancePath = errors[0].instancePath || 'migration script';
    switch (errors[0].keyword) {
      case 'required': {
        const missingProperties = errors.map(e => `'${e.params.missingProperty}'`).join(' or ');
        message = `${instancePath} must have required property ${missingProperties}`;
        break;
      }
      default: {
        message = `${instancePath} ${errors[0].message.replace(/be object/, 'be an object')}`;
        break;
      }
    }
    return new Error(message);
  }

  function decorateMigrationScript(script) {
    script.define_entities?.forEach((entity) => {
      entity.table_name = entity.name.toLowerCase().replace(/\s/g, '_');
      entity.identified_by = entity.fields.filter((field) => {
        return entity.identified_by.includes(field.name);
      });
    });
  }

  return proxy({ runMigration }, pgDriver);
};