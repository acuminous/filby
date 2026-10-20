const { promisify } = require('node:util');
const marvPgDriver = require('marv-pg-driver');
const { Client } = require('pg');

const render = require('./render-migration');
const createValidator = require('./data-validator');

const MISSING_RELATION = ['42P01', '42703'];

module.exports = (config) => {
  const pgDriver = marvPgDriver({ connection: config.database });
  const validator = createValidator();
  let client;

  async function connect() {
    await promisify(pgDriver.connect)();
    client = new Client(config.database);
    await client.connect();
    await seed();
  }

  async function disconnect() {
    await client?.end().catch(noop);
    await promisify(pgDriver.disconnect)();
  }

  async function seed() {
    try {
      const { rows: enums } = await client.query('SELECT name, value FROM fby_enum ORDER BY name, position');
      for (const [name, values] of Map.groupBy(enums, (row) => row.name)) validator.defineEnum(name, values.map((row) => row.value));
      const { rows: fields } = await client.query('SELECT e.id, e.name AS entity, e.version, f.name, f.type, f.identity, f.nullable FROM fby_entity e INNER JOIN fby_entity_field f ON f.entity_id = e.id ORDER BY e.id, f.position');
      for (const [, entityFields] of Map.groupBy(fields, (row) => row.id)) validator.defineEntity({ name: entityFields[0].entity, version: entityFields[0].version, fields: entityFields });
    } catch (err) {
      if (!MISSING_RELATION.includes(err.code)) throw err;
    }
  }

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
    let script;
    try {
      script = render(migration, validator);
    } catch (err) {
      return cb(err);
    }
    pgDriver.runMigration({ ...migration, script }, cb);
  }

  return { ...pgDriver, connect, disconnect, getMigrations, runMigration };
};

function noop() {}
