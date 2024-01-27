const { Filby } = require('..');

const noop = () => { };

module.exports = class TestFilby extends Filby {

  #nukeCustomObjects;

  constructor(config) {
    super(config);
    this.#nukeCustomObjects = config.nukeCustomObjects || noop;
  }

  async reset() {
    await this.init();
    await this.wipe();
  }

  async wipe() {
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
};
