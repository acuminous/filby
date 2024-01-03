const fs = require('fs');
const path = require('path');
const Yaml = require('yaml');
const Handlebars = require('handlebars');
const marvPgDriver = require('marv-pg-driver');

module.exports = (options) => {

  const pgDriver = marvPgDriver(options);

  function connect(cb) {
    pgDriver.connect(cb);
  }

  function disconnect(cb) {
    pgDriver.disconnect(cb);
  }

  function dropMigrations(cb) {
    pgDriver.dropMigrations(cb);
  }

  function ensureMigrations(cb) {
    pgDriver.ensureMigrations(cb);
  }

  function lockMigrations(cb) {
    pgDriver.lockMigrations(cb);
  }

  function unlockMigrations(cb) {
    pgDriver.unlockMigrations(cb);
  }

  function getMigrations(cb) {
    pgDriver.getMigrations(cb);
  }

  function runMigration(migration, cb) {
    if (path.extname(migration.filename) === '.sql') return pgDriver.runMigration(migration, cb);

    const reviver = function(key, value) {
      if (/\s/.test(key)) {
        this[key.replace(/\s/g, '_')] = value;
        return;
      } else {
        return value;
      }
    };

    const document = Yaml.parse(migration.script, reviver);
    document.define_entities?.forEach((entity) => {
      entity.identified_by = entity.fields.filter((field) => {
        return entity.identified_by.includes(field.name);
      });
    });

    const source = fs.readFileSync(path.join(__dirname, 'template.hbs'), 'utf-8');
    const template = Handlebars.compile(source);
    Handlebars.registerHelper('xkeys', (obj, options) => {
      const keys = Object.keys(obj);
      return keys.reduce((result, key, index) => {
        const context = { key, 'isLast': index === keys.length - 1 };
        return result + options.fn(context)
      }, '');
    });
    Handlebars.registerHelper('xvalues', (obj, options) => {
      const values = Object.values(obj);
      return values.reduce((result, value, index) => {
        const context = { value, 'isLast': index === values.length - 1 };
        return result + options.fn(context)
      }, '')
    });
    migration.script = template(document);

    pgDriver.runMigration(migration, cb);
  }

  return {
    connect,
    disconnect,
    dropMigrations,
    ensureMigrations,
    lockMigrations,
    unlockMigrations,
    getMigrations,
    runMigration,
  };
};