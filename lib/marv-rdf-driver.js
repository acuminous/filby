const fs = require('node:fs');
const path = require('node:path');

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const YAML = require('yaml');
const Handlebars = require('handlebars');
const marvPgDriver = require('marv-pg-driver');

const schema = require('./schema.json');
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
    if (!isSupportedFileType(fileType)) return cb(new Error(`Unsupported file type: ${migration.filename}`));

    if (fileType === 'sql') return pgDriver.runMigration(migration, cb);

    const script = parseMigrationScript(migration, fileType);
    if (!validate(script)) return cb(createValidationError(migration, validate.errors));

    const sql = render(decorate(script));
    pgDriver.runMigration({ ...migration, script: sql }, cb);
  }

  function getFileType(migration) {
    return path.extname(migration.filename).replace(/^\./, '');
  }

  function isSupportedFileType(fileType) {
    return ['sql', 'yaml', 'json'].includes(fileType);
  }

  function parseMigrationScript(migration, fileType) {
    if (fileType === 'yaml') return YAML.parse(migration.script, reviver);
    if (fileType === 'json') return JSON.parse(migration.script, reviver);
  }

  function reviver(key, value) {
    if (!/\s/.test(key)) return value;
    this[key.replace(/\s/g, '_')] = value;
  }

  function createValidationError(migration, errors) {
    const instancePath = errors[0].instancePath;

    switch (errors[0].keyword) {
      case 'type': {
        return new Error(`${migration.filename}: ${instancePath} ${getTypeMessage(errors[0])}`);
      }
      case 'required': {
        return new Error(`${migration.filename}: ${instancePath} ${getMissingPropertiesMessage(errors)}`);
      }
      case 'enum': {
        return new Error(`${migration.filename}: ${instancePath} ${getEnumErrorMessage(errors[0])}`);
      }
      default: {
        return new Error(`${migration.filename}: ${instancePath} ${errors[0].message}`);
      }
    }
  }

  function getTypeMessage(error) {
    return error.message
      .replace(/be object/, 'be an object')
      .replace(/be array/, 'be an array');
  }

  function getEnumErrorMessage(error) {
    return `${error.message}: ${error.params.allowedValues.join(', ')}`;
  }

  function getMissingPropertiesMessage(errors) {
    const missingProperties = getMissingProperties(errors);
    const propertyList = missingProperties.map(p => `'${p}'`).join(' or ');
    return `must have required property ${propertyList}`;
  }

  function getMissingProperties(errors) {
    return errors.filter(e => e.keyword === 'required')
      // eslint-disable-next-line no-confusing-arrow
      .reduce((acc, e) => acc.includes(e.params.missingProperty)
        ? acc
        : acc.concat(e.params.missingProperty), []);
  }

  function decorate(script) {
    script.define_entities?.forEach((entity) => {
      // eslint-disable-next-line no-param-reassign
      entity.identified_by = entity.fields.filter((field) => {
        return entity.identified_by.includes(field.name);
      });
    });
    return script;
  }

  return proxy({ runMigration }, pgDriver);
};
