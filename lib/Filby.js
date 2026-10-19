const path = require('node:path');

const EventEmitter = require('eventemitter2');
const { promiseApi: pipsqueak } = require('pipsqueak');
const marv = require('marv/api/promise');
const { Pool, escapeIdentifier } = require('pg');
const { default: parseDuration } = require('parse-duration');

const driver = require('./marv-filby-driver');
const validateConfig = require('./validate-config');
const { aggregate } = require('./helpers');

module.exports = class Filby {

  #config;
  #maxRescheduleDelay;
  #pool;
  #emitter;
  #scheduler;

  static HOOK_MAX_ATTEMPTS_EXHAUSTED = 'HOOK_ATTEMPTS_EXHAUSTED';
  static NOTIFICATION_ERROR = 'NOTIFICATION_ERROR';

  constructor(config) {
    validateConfig(config);
    this.#config = config;
    this.#maxRescheduleDelay = parseDuration(this.#config.notifications?.maxRescheduleDelay || '1h');
    this.#pool = new Pool(config.database);
    this.#emitter = new EventEmitter();
  }

  get config() {
    return this.#config;
  }

  async init() {
    const filbyDirectory = path.join(__dirname, '..', 'migrations');
    const migrationDirectories = this.#config.migrations || ['migrations'];
    const directories = new Set([filbyDirectory, ...migrationDirectories.map((directory) => path.resolve(directory))]);
    const migrations = await Promise.all([...directories].map(async (directory) => {
      const scanned = await marv.scan(directory, { filter: /\.(ya?ml|json|sql)$/ });
      return scanned.map((migration) => ({ ...migration, directory }));
    }));
    await marv.migrate(migrations.flat(), driver(this.#config), { checksums: 'error' });
  }

  async startNotifications() {
    if (this.#scheduler) return;
    this.#scheduler = this.#createScheduler();
    this.#scheduler.on('error', (event) => this.#emitNotificationError(event));
    this.#scheduler.start();
  }

  async stopNotifications() {
    await this.#scheduler?.stop();
    this.#scheduler = undefined;
  }

  subscribe(name, handler) {
    this.#emitter.addListener(name, handler);
  }

  unsubscribe(name, handler) {
    if (handler) this.#emitter.removeListener(name, handler);
    else this.#emitter.removeAllListeners(name);
  }

  unsubscribeAll(...args) {
    this.#emitter.removeAllListeners(...args);
  }

  async stop() {
    await this.stopNotifications();
    await this.#pool.end();
  }

  async withTransaction(fn) {
    const client = await this.#pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      client.release();
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(noop);
      client.release(err);
      throw err;
    }
  }

  async getProjections() {
    return this.withTransaction(async (tx) => {
      const { rows } = await tx.query('SELECT id, name, version FROM fby_projection');
      return rows.map(toProjection);
    });
  }

  async getProjection(name, version) {
    return this.withTransaction(async (tx) => {
      const { rows } = await tx.query('SELECT id, name, version FROM fby_projection WHERE name = $1 AND version = $2', [name, version]);
      return rows.map(toProjection)[0];
    });
  }

  async getChangeLog(projection, { since = 0 } = {}) {
    return this.withTransaction(async (tx) => {
      const { rows } = await tx.query('SELECT DISTINCT ON (change_set_id) change_set_id, effective, description, last_modified, entity_tag, reissued_from FROM fby_projection_change_log_vw WHERE projection_id = $1 AND change_set_id > $2 ORDER BY change_set_id', [projection.id, since]);
      return rows.map(toChangeSet);
    });
  }

  async getCurrentChangeSet(projection) {
    return this.withTransaction(async (tx) => {
      const { rows } = await tx.query(`
        SELECT change_set_id, effective, description, last_modified, entity_tag, reissued_from
        FROM fby_projection_change_log_vw
        WHERE projection_id = $1 AND effective <= now()
        ORDER BY effective DESC, change_set_id DESC
        LIMIT 1`, [projection.id]);
      return rows.map(toChangeSet)[0];
    });
  }

  async getChangeSet(changeSetId) {
    return this.withTransaction(async (tx) => {
      const { rows } = await tx.query('SELECT id AS change_set_id, effective, description, last_modified, entity_tag, reissued_from FROM fby_change_set WHERE id = $1', [changeSetId]);
      return rows.map(toChangeSet)[0];
    });
  }

  async getAggregates(changeSetId, name, version) {
    return this.withTransaction(async (tx) => {
      const functionName = aggregate(name, version);
      const { rowCount: exists } = await tx.query('SELECT 1 FROM pg_proc WHERE proname = $1', [functionName]);
      if (!exists) throw new Error(`Function '${functionName}' does not exist`);
      const { rows } = await tx.query(`SELECT * FROM ${escapeIdentifier(functionName)}($1)`, [changeSetId]);
      return rows;
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
          await this.#sendNotification(tx, notification, maxAttempts);
          return true;
        });
      } while (ok);
    };

    return pipsqueak({ name: 'filby', factory, interval, delay: initialDelay });
  }

  #emitNotificationError({ error }) {
    try {
      this.#emitter.emit(Filby.NOTIFICATION_ERROR, { error });
    } catch {}
  }

  async #sendNotification(tx, notification, maxAttempts) {
    try {
      await this.#emitter.emitAsync(notification.hook.name, notification);
      await this.#passNotification(tx, notification);
    } catch (err) {
      await this.#failNotification(tx, notification, err);
      if (notification.attempts >= maxAttempts) this.#emitter.emitAsync(Filby.HOOK_MAX_ATTEMPTS_EXHAUSTED, { ...notification, err });
    }
  }

  async #getNextNotification(tx, maxAttempts) {
    const { rows } = await tx.query(`
      SELECT n.id, h.name AS hook_name, h.event AS hook_event, n.attempts, n.projection_name, n.projection_version
      FROM fby_get_next_notification($1) n
      INNER JOIN fby_hook h ON h.id = n.hook_id
    `, [maxAttempts]);
    const notifications = rows.map(toNotification);
    return notifications[0];
  }

  async #passNotification(tx, notification) {
    await tx.query('SELECT fby_pass_notification($1)', [notification.id]);
  }

  async #failNotification(tx, notification, err) {
    const rescheduleDelay = Math.min(2 ** notification.attempts * 1000, this.#maxRescheduleDelay);
    const scheduledFor = new Date(Date.now() + rescheduleDelay);
    await tx.query('SELECT fby_fail_notification($1, $2, $3)', [notification.id, scheduledFor, err.stack]);
  }
};

function noop() {}

function toChangeSet(row) {
  return {
    id: row.change_set_id,
    effective: new Date(row.effective),
    description: row.description,
    lastModified: new Date(row.last_modified),
    entityTag: row.entity_tag,
    reissuedFrom: row.reissued_from ?? undefined,
  };
}

function toNotification(row) {
  return {
    id: row.id,
    hook: { name: row.hook_name, event: row.hook_event },
    projection: toProjection({ name: row.projection_name, version: row.projection_version }),
    attempts: row.attempts,
  };
}

function toProjection(row) {
  return {
    ...row,
    key: `${row.name} v${row.version}`,
  };
}
