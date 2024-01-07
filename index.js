const path = require('node:path');

const EventEmitter = require('eventemitter2');
const { promiseApi: pipsqueak } = require('pipsqueak');
const marv = require('marv/api/promise');
const { Pool } = require('pg');
const parseDuration = require('parse-duration');

const driver = require('./lib/marv-rdf-driver');

module.exports = class ReferenceDataFramework extends EventEmitter {

  #config;
  #maxRescheduleDelay;
  #pool;
  #scheduler;

  constructor(config) {
    super();
    this.#config = config;
    this.#maxRescheduleDelay = parseDuration(this.#config.notifications?.maxRescheduleDelay || '1h');
    this.#pool = new Pool(config.database);
  }

  async init() {
    const rdfMigrationsDir = path.join(__dirname, 'migrations');
    const customMigrationsDir = this.#config.migrations || 'migrations';

    await this.#migrate(this.#config.database, rdfMigrationsDir);
    await this.#migrate(this.#config.database, path.resolve(customMigrationsDir));
  }

  async #migrate(connection, directory) {
    const migrations = await marv.scan(directory);
    await marv.migrate(migrations, driver({ connection }));
  }

  async startNotifications() {
    this.#scheduler = this.#createScheduler();
    this.#scheduler.start();
  }

  async stopNotifications() {
    await this.#scheduler?.stop();
  }

  async stop() {
    await this.#scheduler?.stop();
    await this.#pool.end();
  }

  async withTransaction(fn) {
    const client = await this.#pool.connect();
    try {
      const result = await fn(client);
      return result;
    } finally {
      await client.release();
    }
  }

  async getProjections() {
    return this.withTransaction(async (tx) => {
      const { rows } = await tx.query('SELECT id, name, version FROM rdf_projection');
      return rows;
    });
  }

  async getProjection(name, version) {
    return this.withTransaction(async (tx) => {
      const { rows } = await tx.query('SELECT id, name, version FROM rdf_projection WHERE name = $1 AND version = $2', [name, version]);
      return rows[0];
    });
  }

  async getChangeLog(projection) {
    return this.withTransaction(async (tx) => {
      const { rows } = await tx.query('SELECT DISTINCT ON (change_set_id) change_set_id, effective, notes, last_modified, entity_tag FROM rdf_projection_change_log_vw WHERE projection_id = $1', [projection.id]);
      return rows.map(toChangeSet);
    });
  }

  async getChangeSet(changeSetId) {
    return this.withTransaction(async (tx) => {
      const { rows } = await tx.query('SELECT id AS change_set_id, effective, notes, last_modified, entity_tag FROM rdf_change_set WHERE id = $1', [changeSetId]);
      return rows.map(toChangeSet)[0];
    });
  }

  #createScheduler() {
    const maxAttempts = this.#config.notifications?.maxAttempts || 10;
    const interval = this.#config.notifications?.interval || '1m';
    const initialDelay = this.#config.notifications?.initialDelay || '10s';

    const factory = async () => {
      let ok = true;
      do {
        ok = await this.withTransaction(async (tx) => {
          const notification = await this.#getNextNotification(tx, maxAttempts);
          if (!notification) return false;

          try {
            const hook = await this.#getHook(tx, notification);
            await this.emitAsync(hook.event, hook);
            await this.#passNotification(tx, notification);
          } catch (err) {
            await this.#failNotification(tx, notification, err);
          }

          return true;
        });
      } while (ok);
    };

    return pipsqueak({ name: 'rdf-notifications', factory, interval, delay: initialDelay });
  }

  async #getNextNotification(tx, maxAttempts) {
    const { rows } = await tx.query('SELECT id, hook_id, attempts FROM rdf_get_next_notification($1)', [maxAttempts]);
    const notifications = rows.map((row) => ({ id: row.id, hookId: row.hook_id, attempts: row.attempts }));
    return notifications[0];
  }

  async #getHook(tx, notification) {
    const { rows } = await tx.query(
      `SELECT h.event, p.id, p.name, p.version FROM rdf_hook h
INNER JOIN rdf_notification n ON n.hook_id = h.id
INNER JOIN rdf_projection p ON p.id = n.projection_id
WHERE h.id = $1`,
      [notification.hookId],
    );
    const hooks = rows.map((row) => ({ event: row.event, projection: { name: row.name, version: row.version } }));
    return hooks[0];
  }

  async #passNotification(tx, notification) {
    await tx.query('SELECT rdf_pass_notification($1)', [notification.id]);
  }

  async #failNotification(tx, notification, err) {
    const rescheduleDelay = Math.min(2 ** notification.attempts * 1000, this.#maxRescheduleDelay);
    const scheduledFor = new Date(Date.now() + rescheduleDelay);
    await tx.query('SELECT rdf_fail_notification($1, $2, $3)', [notification.id, scheduledFor, err.stack]);
  }
};

function toChangeSet(row) {
  return {
    id: row.change_set_id,
    effective: new Date(row.effective),
    notes: row.notes,
    lastModified: new Date(row.last_modified),
    entityTag: row.entity_tag,
  };
}
