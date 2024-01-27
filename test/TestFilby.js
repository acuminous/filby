const fs = require('node:fs/promises');
const path = require('node:path');

const { Filby } = require('..');

const noop = () => { };
const defaults = {
  database: {
    user: 'fby_test',
    password: 'fby_test',
  },
  migrations: [
    {
      path: 'test/migrations',
      permissions: ['ALL'],
    },
  ],
};

module.exports = class TestFilby extends Filby {

  #migrationsDirectory;
  #nukeCustomObjects;

  constructor(config) {
    super({ ...defaults, ...config });
    this.#migrationsDirectory = path.resolve(this.config.migrations[0].path);
    this.#nukeCustomObjects = config.nukeCustomObjects || noop;
  }

  async reset() {
    await this.#deleteMigrations();
    await this.init();
    await this.#resetDatabase();
  }

  async wipe() {
    await this.#deleteMigrations();
    await this.#resetDatabase();
  }

  async #resetDatabase() {
    return this.withTransaction(async (tx) => {
      await this.#nukeCustomObjects(tx);
      await this.#wipeData(tx);
    });
  }

  async #wipeData(tx) {
    await Promise.all([
      tx.query('DELETE FROM fby_hook'),
      tx.query('DELETE FROM fby_change_set'),
      tx.query('DELETE FROM fby_projection_entity'),
    ]);
    await Promise.all([
      tx.query('DELETE FROM fby_projection'),
      tx.query('DELETE FROM fby_entity'),
    ]);
  }

  async #deleteMigrations() {
    const filenames = await fs.readdir(this.#migrationsDirectory);
    const unlinkMigrationFiles = filenames
      .filter((filename) => ['.sql', '.json', '.yaml', '.avro'].includes(path.extname(filename)))
      .map((filename) => path.join(this.#migrationsDirectory, filename))
      .map((filename) => fs.unlink(filename));
    await unlinkMigrationFiles;
  }

  async applyYaml(name, ...script) {
    return this.apply(name, script.join('\n'), 'yaml');
  }

  async applyJson(name, script) {
    return this.apply(name, script, 'json');
  }

  async applySql(name, script) {
    return this.apply(name, script, 'sql');
  }

  async apply(name, script, extension) {
    const migrationsFilename = path.join(this.#migrationsDirectory, `001.${name.replace(/ /g, '-')}.${extension}`).toLowerCase();
    await fs.writeFile(migrationsFilename, script, { encoding: 'utf-8' });
    return this.init();
  }
};
