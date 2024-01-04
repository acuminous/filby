const fs = require('fs');
const path = require('path');
const YAML = require('yaml');
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
    const extension = path.extname(migration.filename).replace(/^\./, '');;
    if (extension === 'sql') return pgDriver.runMigration(migration, cb);

    const document = getDocument(migration, extension);
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

    Handlebars.registerHelper({
      eq: (a, b) => a === b,
      ne: (a, b) => a !== b,
      lt: (a, b) => a < b,
      gt: (a, b) => a > b,
      lte: (a, b) => a <= b,
      gte: (a, b) => a >= b,
      and() {
        return Array.prototype.every.call(arguments, Boolean);
      },
      or() {
        return Array.prototype.slice.call(arguments, 0, -1).some(Boolean);
      }
    });

    migration.script = template(document);

    pgDriver.runMigration(migration, cb);
  }

  function getDocument(migration, extension) {
    if (extension === 'yaml') return YAML.parse(migration.script, reviver);
    else if (extension === 'json') return JSON.parse(migration.script, reviver);
    else throw new Error(`Unsupported file type: ${extension}`);
  }

  function reviver(key, value) {
    if (/\s/.test(key)) {
      this[key.replace(/\s/g, '_')] = value;
      return;
    } else {
      return value;
    }
  };

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