import pipsqueak from 'pipsqueak';
import { Client } from 'pg';
import parseDuration from 'parse-duration';

import { MIGRATION_LOCK_KEY } from '../migrations/run-migrations.js';
import { toProjection } from '../mappers.js';

class Notifier {

  #config;
  #maxAttempts;
  #maxRescheduleDelay;
  #handlerTimeout;
  #emitter;
  #withTransaction;
  #onError;
  #onExhausted;
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

  constructor({ config, maxAttempts, emitter, withTransaction, onError, onExhausted }) {
    this.#config = config;
    this.#maxAttempts = maxAttempts;
    this.#maxRescheduleDelay = parseDuration(config.notifications?.maxRescheduleDelay || '1h');
    this.#handlerTimeout = parseDuration(config.notifications?.handlerTimeout || '30s');
    this.#emitter = emitter;
    this.#withTransaction = withTransaction;
    this.#onError = onError;
    this.#onExhausted = onExhausted;
  }

  async start() {
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
    this.#scheduler.on('error', (event) => this.#onError(event));
    this.#scheduler.start();
    if (this.#config.notifications?.listen) await this.#startListener();
  }

  async stop() {
    this.#stopping = true;
    for (const controller of this.#controllers) controller.abort(new Error('Filby stopped before the handlers completed'));
    await this.#stopListener();
    await this.#scheduler?.stop();
    this.#scheduler = undefined;
  }

  async getStatus() {
    const { rows: [counts] } = await this.#withTransaction((tx) => tx.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'PENDING')::INTEGER AS pending,
        COUNT(*) FILTER (WHERE status = 'CLAIMED')::INTEGER AS claimed,
        COUNT(*) FILTER (WHERE status = 'PENDING' AND scheduled_for < now() AND attempts < $1)::INTEGER AS overdue,
        COUNT(*) FILTER (WHERE status = 'PENDING' AND attempts >= $1)::INTEGER AS exhausted
      FROM fby_notification`, [this.#maxAttempts]));
    return {
      started: Boolean(this.#scheduler),
      poller: this.#scheduler?.status('filby'),
      lastSuccessfulPollAt: this.#lastSuccessfulPollAt,
      failuresSinceLastSuccess: this.#failuresSinceLastSuccess,
      lastError: this.#lastError,
      ...counts,
    };
  }

  #createScheduler() {
    const maxAttempts = this.#maxAttempts;
    const interval = this.#config.notifications?.interval || '1m';
    const initialDelay = this.#config.notifications?.initialDelay || '10s';
    const stopTimeout = this.#handlerTimeout + 5000;

    this.#stopping = false;
    const factory = async () => {
      let notification;
      do {
        notification = await this.#getNextNotification(maxAttempts, stopTimeout);
        if (notification) await this.#sendNotification(notification, maxAttempts);
      } while (notification && !this.#stopping);
    };

    return pipsqueak.promiseApi({ name: 'filby', factory, interval, delay: initialDelay, timeout: stopTimeout });
  }

  async #startListener() {
    const client = new Client(this.#config.database);
    this.#listener = client;
    client.on('notification', () => this.#poke());
    client.once('error', (error) => this.#onError({ error }));
    client.on('error', noop);
    client.on('end', () => this.#restartListener(client));
    try {
      await Promise.race([client.connect(), new Promise((resolve) => client.once('end', resolve))]);
      await client.query('LISTEN fby_notification');
      this.#listenerAttempts = 0;
    } catch (error) {
      if (this.#listener !== client) return;
      this.#onError({ error });
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

  async #sendNotification(notification, maxAttempts) {
    try {
      await this.#runHandlers(notification);
    } catch (err) {
      await this.#failNotification(notification, err);
      this.#onError({ error: err, notification });
      if (notification.attempts >= maxAttempts) this.#onExhausted({ error: err, notification });
      return;
    }
    await this.#passNotification(notification);
  }

  async #runHandlers(notification) {
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
    } finally {
      clearTimeout(timer);
      this.#controllers.delete(controller);
    }
  }

  async #getNextNotification(maxAttempts, claimTimeout) {
    return this.#withTransaction(async (tx) => {
      const { rows: [{ granted }] } = await tx.query('SELECT pg_try_advisory_xact_lock_shared($1) AS granted', [MIGRATION_LOCK_KEY]);
      if (!granted) return;
      const { rows } = await tx.query(`
        SELECT n.id, h.name AS hook_name, h.event AS hook_event, n.attempts, n.projection_name, n.projection_version
        FROM fby_get_next_notification($1, $2) n
        INNER JOIN fby_hook h ON h.id = n.hook_id
      `, [maxAttempts, claimTimeout]);
      const notifications = rows.map(toNotification);
      return notifications[0];
    });
  }

  async #passNotification(notification) {
    await this.#withTransaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock_shared($1)', [MIGRATION_LOCK_KEY]);
      await tx.query('SELECT fby_pass_notification($1)', [notification.id]);
    });
  }

  async #failNotification(notification, err) {
    const rescheduleDelay = Math.min(2 ** notification.attempts * 1000, this.#maxRescheduleDelay);
    const scheduledFor = new Date(Date.now() + rescheduleDelay);
    await this.#withTransaction(async (tx) => {
      await tx.query('SELECT pg_advisory_xact_lock_shared($1)', [MIGRATION_LOCK_KEY]);
      await tx.query('SELECT fby_fail_notification($1, $2, $3)', [notification.id, scheduledFor, err?.stack ?? String(err)]);
    });
  }
}

function rejectOnAbort(signal) {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

function toNotification(row) {
  return {
    id: row.id,
    hook: { name: row.hook_name, event: row.hook_event },
    projection: toProjection({ name: row.projection_name, version: row.projection_version }),
    attempts: row.attempts,
  };
}

function noop() {}

export { Notifier };
