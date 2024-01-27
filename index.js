const path = require('node:path');

const EventEmitter = require('eventemitter2');
const { promiseApi: pipsqueak } = require('pipsqueak');
const marv = require('marv/api/promise');
const { Pool } = require('pg');
const parseDuration = require('parse-duration');

const driver = require('./lib/marv-filby-driver');
const { aggregate } = require('./lib/helpers');

module.exports = class Filby {

  #config;
  #maxRescheduleDelay;
  #pool;
  #emitter;
  #scheduler;

  static HOOK_MAX_ATTEMPTS_EXHAUSTED = 'HOOK_ATTEMPTS_EXHAUSTED';

  constructor(config) {
    this.#config = config;
    this.#maxRescheduleDelay = parseDuration(this.#config.notifications?.maxRescheduleDelay || '1h');
    this.#pool = new Pool(config.database);
    this.#emitter = new EventEmitter();
  }

  async init() {
    const filbyDirectory = path.join(__dirname, 'migrations');
    const filbyDirectoryPermissions = [{ path: filbyDirectory, permissions: ['ALL'] }];
    const relativeDirectoryPermissions = this.#config.migrations || [{ migrations: ['ALL'] }];
    const absoluteDirectoryPermissions = this.#expandDirectoryPermissions(relativeDirectoryPermissions);
    await this.#migrateAll([...filbyDirectoryPermissions, ...absoluteDirectoryPermissions]);
  }

  #expandDirectoryPermissions(relativeDirectoryPermissions) {
    return relativeDirectoryPermissions.reduce((absoluteDirectoryPermissions, directoryPermissions) => ([
      ...absoluteDirectoryPermissions,
      {
        path: path.resolve(directoryPermissions.path),
        permissions: expand(directoryPermissions.permissions),
      },
    ]), []);
  }

  async #migrateAll(directoryPermissions) {
    // eslint-disable-next-line no-restricted-syntax
    for (const { path: directory, permissions } of directoryPermissions) {
      const migrations = await marv.scan(directory, { filter: /(?:\.*yaml|\.*json|.*sql)$/ });
      await marv.migrate(migrations, driver(this.#config, permissions));
    }
  }

  async startNotifications() {
    this.#scheduler = this.#createScheduler();
    this.#scheduler.start();
  }

  async stopNotifications() {
    await this.#scheduler?.stop();
  }

  subscribe(name, handler) {
    this.#emitter.addListener(name, handler);
  }

  unsubscribe(name, handler) {
    this.#emitter.removeListener(name, handler);
  }

  unsubscribeAll(...args) {
    this.#emitter.removeAllListeners(...args);
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

  async getChangeLog(projection) {
    return this.withTransaction(async (tx) => {
      const { rows } = await tx.query('SELECT DISTINCT ON (change_set_id) change_set_id, effective, description, last_modified, entity_tag FROM fby_projection_change_log_vw WHERE projection_id = $1', [projection.id]);
      return rows.map(toChangeSet);
    });
  }

  async getCurrentChangeSet(projection) {
    return this.withTransaction(async (tx) => {
      const { rows } = await tx.query(`
SELECT change_set_id, effective, description, last_modified, entity_tag
FROM fby_projection_change_log_vw
WHERE projection_id = $1 AND effective <= now()
ORDER BY effective DESC, change_set_id DESC
LIMIT 1`, [projection.id]);
      return rows.map(toChangeSet)[0];
    });
  }

  async getChangeSet(changeSetId) {
    return this.withTransaction(async (tx) => {
      const { rows } = await tx.query('SELECT id AS change_set_id, effective, description, last_modified, entity_tag FROM fby_change_set WHERE id = $1', [changeSetId]);
      return rows.map(toChangeSet)[0];
    });
  }

  async getAggregates(changeSetId, name, version) {
    return this.withTransaction(async (tx) => {
      const functionName = aggregate(name, version);
      const { rowCount: exists } = await tx.query('SELECT 1 FROM pg_proc WHERE proname = $1', [functionName]);
      if (!exists) throw new Error(`Function '${functionName}' does not exist`);
      const { rows } = await tx.query(`SELECT * FROM ${functionName}($1)`, [changeSetId]);
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

    return pipsqueak({
      name: 'filby-notifications', factory, interval, delay: initialDelay,
    });
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

function toChangeSet(row) {
  return {
    id: row.change_set_id,
    effective: new Date(row.effective),
    description: row.description,
    lastModified: new Date(row.last_modified),
    entityTag: row.entity_tag,
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

function expand(permissions) {
  const ALL_OPERATIONS = ['ADD_CHANGE_SET', 'ADD_ENUM', 'ADD_ENTITY', 'ADD_HOOK', 'ADD_PROJECTION', 'DROP_ENUM', 'DROP_ENTITY', 'DROP_HOOK', 'DROP_PROJECTION'];
  return permissions.reduce((expanded, permission) => {
    switch (permission) {
      case 'ALL': return expanded.concat(['SQL', ...ALL_OPERATIONS, 'CHECK_CONSTRAINT']);
      case 'ALL_OPERATIONS': return expanded.concat(ALL_OPERATIONS);
      default: return expanded.concat(permission);
    }
  }, []);
}
