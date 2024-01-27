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
}

module.exports = class TestFilby extends Filby {

  #migrationsDirectory;
  #nukeCustomObjects;

  constructor(config) {
    super({ ...defaults, ...config });
    this.#migrationsDirectory = path.resolve(this.config.migrations[0].path);
    this.#nukeCustomObjects = config.nukeCustomObjects || noop;
  }

  async reset() {
    await this.#wipeMigrations();
    await this.init();
    await this.wipe();
  }

  async wipe() {
    await this.#wipeMigrations();
    await this.withTransaction(async (tx) => {
      await this.#nukeCustomObjects(tx);
      await this.#wipeData(tx);
    });
  }

  async #wipeData(tx) {
    await tx.query('DELETE FROM fby_notification');
    await tx.query('DELETE FROM fby_hook');
    await tx.query('DELETE FROM fby_data_frame');
    await tx.query('DELETE FROM fby_projection_entity');
    await tx.query('DELETE FROM fby_entity');
    await tx.query('DELETE FROM fby_change_set');
    await tx.query('DELETE FROM fby_projection');
  }

  async #wipeMigrations() {
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
