const crypto = require('node:crypto');
const path = require('node:path');
const { promisify } = require('node:util');

const YAML = require('yaml');
const marvPgDriver = require('marv-pg-driver');

const compile = require('./compile-template');
const validate = require('./validate-migration');

module.exports = (config, migrations, pool) => {
  const pgDriver = marvPgDriver({ connection: config.database });
  const pg = Object.fromEntries(Object.entries(pgDriver).map(([name, fn]) => [name, promisify(fn)]));

  async function getMigrations() {
    const rows = await pg.getMigrations();
    return Promise.all(rows.map(baseline));
  }

  async function baseline(row) {
    if (!/^[0-9a-f]{32}$/.test(row.checksum)) return row;
    const migration = migrations.find(({ namespace = 'default', level, checksum }) => namespace === row.namespace && level === row.level && checksum);
    if (!migration || md5(migration.script) !== row.checksum) return row;
    await pool.query('UPDATE migrations SET checksum = $1 WHERE namespace = $2 AND level = $3', [migration.checksum, row.namespace, row.level]);
    return { ...row, checksum: migration.checksum };
  }

  function md5(script) {
    return crypto.createHash('md5').update(script, 'utf8').digest('hex');
  }

  async function runMigration(migration) {
    const fileType = getFileType(migration);
    switch (fileType) {
      case 'sql': return pg.runMigration(migration);
      case 'json': return pg.runMigration(prepareMigration(JSON.parse, migration));
      case 'yml':
      case 'yaml': return pg.runMigration(prepareMigration(YAML.parse, migration));
      default: throw new Error(`Unsupported file type: ${fileType}`);
    }
  }

  function getFileType(migration) {
    return path.extname(migration.filename).replace(/^\./, '');
  }

  function prepareMigration(parseFn, migration) {
    return { ...migration, script: getSql(parseFn, migration) };
  }

  function getSql(parseFn, migration) {
    const document = parseFn(migration.script);
    validate(migration.filename, document);
    completeIdentityFields(document);
    return renderSql(migration, document);
  }

  function completeIdentityFields(script) {
    script.forEach((instruction) => {
      if (instruction.operation !== 'ADD_ENTITY') return;
      const identityFields = instruction.identified_by.map((fieldName) => {
        const field = instruction.fields.find((f) => f.name === fieldName);
        if (!field) throw new Error(`Identifier '${fieldName}' does not match one of the '${instruction.name}' entity field names`);
        return field;
      });
      instruction.identified_by = identityFields;
    });
  }

  function renderSql({ filename, directory }, script) {
    const data = { filename, directory };
    const render = compile(__dirname, 'template.hbs');
    return render(script, { data });
  }

  return {
    connect: () => pg.connect(),
    disconnect: () => pg.disconnect(),
    dropMigrations: () => pg.dropMigrations(),
    ensureMigrations: () => pg.ensureMigrations(),
    lockMigrations: () => pg.lockMigrations(),
    unlockMigrations: () => pg.unlockMigrations(),
    getMigrations,
    runMigration,
  };
};
