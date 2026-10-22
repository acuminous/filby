const path = require('node:path');

const EventEmitter = require('eventemitter2');
const { promiseApi: pipsqueak } = require('pipsqueak');
const marv = require('marv/api/promise');
const { Pool, Client, TypeOverrides, types, escapeIdentifier } = require('pg');
const { default: parseDuration } = require('parse-duration');

const driver = require('./marv-filby-driver');
const validateConfig = require('./validate-config');
const http = require('./http');
const { aggregate, projectionFunction, projectionArguments, nestOrder, nestPredicates } = require('./helpers');

module.exports = class Filby {

  #config;
  #maxRescheduleDelay;
  #handlerTimeout;
  #types;
  #pool;
  #emitter;
  #scheduler;
  #listener;
  #listenerTimer;
  #listenerAttempts = 0;
  #pokePending = false;
  #stopping = false;
  #controllers = new Set();
  #pollFailed = false;
  #lastSuccessfulPollAt;
  #failuresSinceLastSuccess = 0;
  #lastError;

  static HOOK_MAX_ATTEMPTS_EXHAUSTED = 'HOOK_ATTEMPTS_EXHAUSTED';
  static NOTIFICATION_ERROR = 'NOTIFICATION_ERROR';
  static MIGRATION_LOCK_KEY = 102105108098121;

  constructor(config) {
    validateConfig(config);
    this.#config = config;
    this.#maxRescheduleDelay = parseDuration(this.#config.notifications?.maxRescheduleDelay || '1h');
    this.#handlerTimeout = parseDuration(this.#config.notifications?.handlerTimeout || '30s');
    this.#types = new TypeOverrides(config.database?.types);
    this.#pool = new Pool({ ...config.database, types: this.#types });
    this.#emitter = new EventEmitter();
    this.#pool.on('error', (error) => this.#emitNotificationError({ error }));
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
    const client = await this.#pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [Filby.MIGRATION_LOCK_KEY]);
      await marv.migrate(migrations.flat(), driver(this.#config), { checksums: 'error' });
      await this.#registerEnumArrayParsers(client);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [Filby.MIGRATION_LOCK_KEY]).catch(noop);
      await client.query("SELECT pg_notify('fby_notification', '')").catch(noop);
      client.release();
    }
  }

  async startNotifications() {
    if (this.#scheduler) return;
    this.#scheduler = this.#createScheduler();
    this.#scheduler.on('begin', () => {
      this.#pollFailed = false;
      this.#pokePending = false;
    });
    this.#scheduler.on('error', ({ timestamp, error }) => {
      this.#pollFailed = true;
      this.#failuresSinceLastSuccess++;
      this.#lastError = { at: new Date(timestamp), message: error.message };
    });
    this.#scheduler.on('end', ({ timestamp }) => {
      if (this.#pokePending) setImmediate(() => this.#scheduler?.poke('filby'));
      if (this.#pollFailed) return;
      this.#lastSuccessfulPollAt = new Date(timestamp);
      this.#failuresSinceLastSuccess = 0;
    });
    this.#scheduler.on('error', (event) => this.#emitNotificationError(event));
    this.#scheduler.start();
    if (this.#config.notifications?.listen) await this.#startListener();
  }

  async stopNotifications() {
    this.#stopping = true;
    for (const controller of this.#controllers) controller.abort(new Error('Filby stopped before the handlers completed'));
    await this.#stopListener();
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

  async getNotificationStatus() {
    const maxAttempts = this.#config.notifications?.maxAttempts || 10;
    const { rows: [counts] } = await this.withTransaction((tx) => tx.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'PENDING')::INTEGER AS pending,
        COUNT(*) FILTER (WHERE status = 'PENDING' AND scheduled_for < now())::INTEGER AS overdue,
        COUNT(*) FILTER (WHERE status = 'PENDING' AND attempts >= $1)::INTEGER AS exhausted
      FROM fby_notification`, [maxAttempts]));
    return {
      started: Boolean(this.#scheduler),
      poller: this.#scheduler?.status('filby'),
      lastSuccessfulPollAt: this.#lastSuccessfulPollAt,
      failuresSinceLastSuccess: this.#failuresSinceLastSuccess,
      lastError: this.#lastError,
      ...counts,
    };
  }

  async getAggregates(changeSetId, name, version) {
    return this.withTransaction(async (tx) => {
      const functionName = aggregate(name, version);
      const { rowCount: functionExists } = await tx.query('SELECT 1 FROM pg_proc WHERE proname = $1', [functionName]);
      if (!functionExists) throw new Error(`Function '${functionName}' does not exist`);
      const { rowCount: changeSetExists } = await tx.query('SELECT 1 FROM fby_change_set WHERE id = $1', [changeSetId]);
      if (!changeSetExists) throw new Error(`Change set ${changeSetId} does not exist`);
      const { rows } = await tx.query(`SELECT * FROM ${escapeIdentifier(functionName)}($1)`, [changeSetId]);
      return rows;
    });
  }

  async getDocuments(projection, changeSetId, { parameters = {}, pageOffset, pageSize } = {}) {
    return this.withTransaction(async (tx) => {
      const { rows: [declaration] } = await tx.query('SELECT id, root_entity_id, page_size FROM fby_projection WHERE name = $1 AND version = $2', [projection.name, projection.version]);
      if (!declaration?.root_entity_id) throw new Error(`Projection '${projection.key}' is not declared with a root`);

      const { rows: declaredParameters } = await tx.query('SELECT name, match FROM fby_projection_parameter WHERE projection_id = $1 ORDER BY position', [declaration.id]);
      const names = declaredParameters.flatMap(projectionArguments).map(({ name }) => name.slice(2));
      const unknown = Object.keys(parameters).find((name) => !names.includes(name));
      if (unknown) throw new Error(`Projection '${projection.key}' has no parameter '${unknown}'${parameterHint(names)}`);

      const values = [changeSetId, ...names.map((name) => parameters[name] ?? null)];
      if (declaration.page_size) values.push(pageOffset ?? 0, pageSize ?? declaration.page_size);
      const root = `${escapeIdentifier(projectionFunction(projection.name, projection.version))}(${values.map((_, index) => `$${index + 1}`).join(', ')})`;

      const { rows } = await tx.query(`SELECT * FROM ${root}`, values);
      const documents = rows.map(({ fby_total, ...document }) => document);
      let total = declaration.page_size ? rows[0]?.fby_total ?? 0 : documents.length;
      if (declaration.page_size && rows.length === 0 && pageOffset > 0) {
        const { rows: [first] } = await tx.query(`SELECT fby_total FROM ${root}`, [...values.slice(0, -2), 0, 1]);
        total = first?.fby_total ?? 0;
      }

      const { rows: declared } = await tx.query('SELECT n.id, n.parent_nest_id, n.name, n.entity_id, n.lookup, e.name AS entity, e.version FROM fby_projection_nest n INNER JOIN fby_entity e ON e.id = n.entity_id WHERE n.projection_id = $1 ORDER BY n.position', [declaration.id]);
      const nests = [];
      for (const nest of declared) {
        const { rows: on } = await tx.query('SELECT field, parent_field FROM fby_projection_nest_on WHERE nest_id = $1 ORDER BY position', [nest.id]);
        const { rows: order } = await tx.query('SELECT field, direction, nulls FROM fby_projection_nest_order WHERE nest_id = $1 ORDER BY position', [nest.id]);
        const { rows: key } = await tx.query('SELECT name AS field FROM fby_entity_field WHERE entity_id = $1 AND identity ORDER BY position', [nest.entity_id]);
        nests.push({ ...nest, on, order: [...order, ...key.map(({ field }) => ({ field, direction: 'ASC' }))], source: `${escapeIdentifier(aggregate(nest.entity, nest.version))}($1)` });
      }

      const attachNests = async (parents, parentNestId, lineage) => {
        for (const nest of nests.filter((candidate) => candidate.parent_nest_id === parentNestId)) {
          const alias = `c${lineage.length}`;
          const { rows: children } = await tx.query(`SELECT ${alias}.* FROM ${nest.source} ${alias} WHERE ${semiJoin(lineage, alias, nest.on)} ORDER BY ${nestOrder(alias, nest.order)}`, values);
          if (!nest.lookup) await attachNests(children, nest.id, [{ source: nest.source, alias, on: nest.on }, ...lineage]);
          attachChildren(parents, nest, children);
        }
      };
      await attachNests(documents, null, [{ source: root, alias: 'a' }]);

      return { documents, total };
    });
  }

  async fetch(request, options) {
    return http(this, request, options);
  }

  async #registerEnumArrayParsers(client) {
    const { rows } = await client.query('SELECT t.typarray FROM pg_type t WHERE t.typname IN (SELECT DISTINCT name FROM fby_enum)');
    for (const { typarray } of rows) this.#types.setTypeParser(typarray, types.getTypeParser(1009, 'text'));
  }

  #createScheduler() {
    const maxAttempts = this.#config.notifications?.maxAttempts || 10;
    const interval = this.#config.notifications?.interval || '1m';
    const initialDelay = this.#config.notifications?.initialDelay || '10s';
    const stopTimeout = this.#handlerTimeout + 5000;

    this.#stopping = false;
    const factory = async () => {
      let ok = true;
      do {
        ok = await this.withTransaction(async (tx) => {
          const { rows: [{ granted }] } = await tx.query('SELECT pg_try_advisory_xact_lock_shared($1) AS granted', [Filby.MIGRATION_LOCK_KEY]);
          if (!granted) return false;
          const notification = await this.#getNextNotification(tx, maxAttempts);
          if (!notification) return false;
          await this.#sendNotification(tx, notification, maxAttempts);
          return true;
        });
      } while (ok && !this.#stopping);
    };

    return pipsqueak({ name: 'filby', factory, interval, delay: initialDelay, timeout: stopTimeout });
  }

  async #startListener() {
    const client = new Client(this.#config.database);
    this.#listener = client;
    client.on('notification', () => this.#poke());
    client.once('error', (error) => this.#emitNotificationError({ error }));
    client.on('error', noop);
    client.on('end', () => this.#restartListener(client));
    try {
      await Promise.race([client.connect(), new Promise((resolve) => client.once('end', resolve))]);
      await client.query('LISTEN fby_notification');
      this.#listenerAttempts = 0;
    } catch (error) {
      if (this.#listener !== client) return;
      this.#emitNotificationError({ error });
      await client.end().catch(noop);
    }
  }

  #restartListener(client) {
    if (this.#listener !== client) return;
    this.#listener = undefined;
    const delay = Math.min(2 ** this.#listenerAttempts++ * 1000, 60000);
    this.#listenerTimer = setTimeout(() => this.#startListener(), delay).unref();
  }

  async #stopListener() {
    clearTimeout(this.#listenerTimer);
    const client = this.#listener;
    this.#listener = undefined;
    this.#listenerAttempts = 0;
    await client?.end();
  }

  #poke() {
    this.#pokePending = true;
    this.#scheduler?.poke('filby');
  }

  #emitNotificationError({ error, notification }, event = Filby.NOTIFICATION_ERROR) {
    try {
      this.#emitter.emit(event, { error, notification });
    } catch {}
  }

  async #sendNotification(tx, notification, maxAttempts) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`Handlers timed out after ${this.#handlerTimeout}ms`)), this.#handlerTimeout);
    this.#controllers.add(controller);
    if (this.#stopping) controller.abort(new Error('Filby stopped before the handlers started'));
    try {
      if (this.#emitter.listenerCount(notification.hook.name) === 0) throw new Error(`No subscribers for hook '${notification.hook.name}'`);
      await Promise.race([
        this.#emitter.emitAsync(notification.hook.name, notification, { signal: controller.signal }),
        rejectOnAbort(controller.signal),
      ]);
      await this.#passNotification(tx, notification);
    } catch (err) {
      await this.#failNotification(tx, notification, err);
      this.#emitNotificationError({ error: err, notification });
      if (notification.attempts >= maxAttempts) this.#emitNotificationError({ error: err, notification }, Filby.HOOK_MAX_ATTEMPTS_EXHAUSTED);
    } finally {
      clearTimeout(timer);
      this.#controllers.delete(controller);
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

function rejectOnAbort(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

function parameterHint(names) {
  return names.length ? `; existing parameters are ${names.map((name) => `'${name}'`).join(', ')}` : '';
}

function semiJoin([parent, ...ancestors], alias, on) {
  const nested = ancestors.length ? ` AND ${semiJoin(ancestors, parent.alias, parent.on)}` : '';
  return `EXISTS (SELECT 1 FROM ${parent.source} ${parent.alias} WHERE ${nestPredicates(alias, parent.alias, on)}${nested})`;
}

function attachChildren(parents, { name, on, lookup }, children) {
  const index = new Map();
  for (const parent of parents) {
    parent[name] = lookup ? null : [];
    const key = JSON.stringify(on.map(({ parent_field }) => parent[parent_field]));
    index.set(key, [...(index.get(key) ?? []), parent]);
  }
  for (const child of children) {
    const key = JSON.stringify(on.map(({ field }) => child[field]));
    const document = Object.fromEntries(Object.entries(child).filter(([field]) => !on.some((join) => join.field === field)));
    for (const parent of index.get(key) ?? []) {
      if (lookup) parent[name] = document;
      else parent[name].push(document);
    }
  }
}

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
