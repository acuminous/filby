const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
const Handlebars = require('handlebars');
const marvPgDriver = require('marv-pg-driver');

const proxy = require('./proxy');
const helpers = require('./helpers');

const templateSource = fs.readFileSync(path.join(__dirname, 'template.hbs'), 'utf-8');
const template = Handlebars.compile(templateSource);

Handlebars.registerHelper(helpers);

module.exports = (options) => {

  const pgDriver = marvPgDriver(options);

  function runMigration(migration, cb) {
    const fileType = getFileType(migration);

    if (fileType === 'sql') return pgDriver.runMigration(migration, cb);

    const script = parseMigrationScript(migration, fileType);
    decorateMigrationScript(script);

    pgDriver.runMigration({ ...migration, script: template(script) }, cb);
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