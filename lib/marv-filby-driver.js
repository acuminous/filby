const marvPgDriver = require('marv-pg-driver');

const render = require('./render-migration');

module.exports = (config) => {
  const pgDriver = marvPgDriver({ connection: config.database });

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
      script = render(migration);
    } catch (err) {
      return cb(err);
    }
    pgDriver.runMigration({ ...migration, script }, cb);
  }

  return { ...pgDriver, getMigrations, runMigration };
};
