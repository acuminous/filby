import fs from 'node:fs/promises';
import path from 'node:path';

import { Filby } from '../index.js';

const noop = () => { };
const defaults = {
  database: {
    user: 'fby_test',
    password: 'fby_test',
  },
  migrations: ['test/migrations'],
};

export default class TestFilby extends Filby {

  #migrationsDirectory;
  #nukeCustomObjects;

  constructor({ nukeCustomObjects = noop, ...config }) {
    super({ ...defaults, ...config });
    this.#migrationsDirectory = path.resolve(this.config.migrations[0]);
    this.#nukeCustomObjects = nukeCustomObjects;
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
    await tx.query('DELETE FROM fby_hook');
    await tx.query('DELETE FROM fby_change_set');
    await tx.query('DELETE FROM fby_projection_entity');
    await tx.query('DELETE FROM fby_projection');
    await tx.query('DELETE FROM fby_entity');
    await tx.query('DELETE FROM fby_enum');
  }

  async #deleteMigrations() {
    const filenames = await fs.readdir(this.#migrationsDirectory);
    const unlinkMigrationFiles = filenames
      .filter((filename) => ['.sql', '.json', '.yaml', '.csv'].includes(path.extname(filename)))
      .map((filename) => path.join(this.#migrationsDirectory, filename))
      .map((filename) => fs.unlink(filename));
    await Promise.all(unlinkMigrationFiles);
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
}
