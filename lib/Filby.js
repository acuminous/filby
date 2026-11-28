import EventEmitter from 'eventemitter2';
import { Pool, TypeOverrides, escapeIdentifier } from 'pg';

import { MIGRATION_LOCK_KEY, scanMigrations, runMigrations, checkMigrations } from './migrations/run-migrations.js';
import { Notifier } from './notifications/notifier.js';
import { getDocuments } from './documents/get-documents.js';
import { LOCAL_DATE_PARSERS, registerEnumArrayParsers } from './database/type-parsers.js';
import { validateConfig } from './validate-config.js';
import { fetchProjections } from './http/projections/fetch-projections.js';
import { fetchDeclarations } from './http/declarations/fetch-declarations.js';
import { fetchStatus } from './http/status/fetch-status.js';
import { exportBundle } from './export/export-bundle.js';
import { toChangeSet, toProjection } from './mappers.js';
import { aggregate } from './naming.js';
import { sql } from './database/sql.js';

/**
 * @import { PoolClient } from 'pg'
 * @import { Config, HandlerContext, Projection, ChangeSet, Notification, NotificationError, MaxAttemptsExhausted, NotificationStatus, DocumentOptions, Documents, FetchOptions, Bundle } from '../index.js'
 */

/**
 * @template T
 * @typedef {(notification: T, context: HandlerContext) => void | Promise<void>} Handler
 */

class Filby {

  #config;
  #types;
  #pool;
  #emitter;
  #notifier;
  #initialised = false;
  #stopped;

  /** @readonly */
  static HOOK_MAX_ATTEMPTS_EXHAUSTED = 'HOOK_MAX_ATTEMPTS_EXHAUSTED';
  /** @readonly */
  static NOTIFICATION_ERROR = 'NOTIFICATION_ERROR';
  static MIGRATION_LOCK_KEY = MIGRATION_LOCK_KEY;

  /** @param {Config} config */
  constructor(config) {
    validateConfig(config);
    this.#config = config;
    this.#types = new TypeOverrides(config.database?.types);
    if (config.localDateTypes !== 'pg') for (const [oid, parser] of LOCAL_DATE_PARSERS) this.#types.setTypeParser(oid, parser);
    this.#pool = new Pool({ ...config.database, types: this.#types });
    this.#emitter = new EventEmitter();
    this.#notifier = new Notifier({
      config,
      maxAttempts: this.#maxAttempts,
      emitter: this.#emitter,
      withTransaction: (callback) => this.withTransaction(callback),
      onError: (event) => this.#emitNotificationError(event),
      onExhausted: (event) => this.#emitNotificationError(event, Filby.HOOK_MAX_ATTEMPTS_EXHAUSTED),
    });
    this.#pool.on('error', (error) => this.#emitNotificationError({ error }));
  }

  /** @returns {Config} */
  get config() {
    return this.#config;
  }

  async init({ migrate = true } = {}) {
    const migrations = await scanMigrations(this.#config);
    const client = await this.#pool.connect();
    try {
      if (migrate) await runMigrations(client, migrations, this.#config);
      else await checkMigrations(client, migrations);
      const { rows } = await client.query(sql.types.listEnumArrayTypes);
      registerEnumArrayParsers(this.#types, rows);
      this.#initialised = true;
    } finally {
      client.release();
    }
  }

  async startNotifications() {
    await this.#notifier.start();
  }

  async stopNotifications() {
    await this.#notifier.stop();
  }

  /**
   * @overload
   * @param {'NOTIFICATION_ERROR'} event
   * @param {(event: NotificationError) => void} handler
   * @returns {void}
   */
  /**
   * @overload
   * @param {'HOOK_MAX_ATTEMPTS_EXHAUSTED'} event
   * @param {(event: MaxAttemptsExhausted) => void} handler
   * @returns {void}
   */
  /**
   * @template [T=Notification]
   * @overload
   * @param {string} event
   * @param {Handler<T>} handler
   * @returns {void}
   */
  /**
   * @param {string} event
   * @param {(...args: any[]) => void} handler
   */
  subscribe(event, handler) {
    this.#emitter.addListener(event, handler);
  }

  /**
   * @overload
   * @param {'NOTIFICATION_ERROR'} event
   * @param {(event: NotificationError) => void} [handler]
   * @returns {void}
   */
  /**
   * @overload
   * @param {'HOOK_MAX_ATTEMPTS_EXHAUSTED'} event
   * @param {(event: MaxAttemptsExhausted) => void} [handler]
   * @returns {void}
   */
  /**
   * @template [T=Notification]
   * @overload
   * @param {string} event
   * @param {Handler<T>} [handler]
   * @returns {void}
   */
  /**
   * @param {string} event
   * @param {(...args: any[]) => void} [handler]
   */
  unsubscribe(event, handler) {
    if (handler) this.#emitter.removeListener(event, handler);
    else this.#emitter.removeAllListeners(event);
  }

  /** @param {string} [event] */
  unsubscribeAll(event) {
    this.#emitter.removeAllListeners(event);
  }

  /** @returns {Promise<void>} */
  stop() {
    this.#stopped ??= this.stopNotifications().then(() => this.#pool.end());
    return this.#stopped;
  }

  /**
   * @template T
   * @param {(client: PoolClient) => Promise<T>} callback
   * @returns {Promise<T>}
   */
  async withTransaction(callback) {
    const client = await this.#pool.connect();
    client.on('error', noop);
    let releaseError;
    try {
      await this.#begin(client);
      const result = await callback(client);
      await client.query(sql.transactions.commit);
      return result;
    } catch (err) {
      releaseError = await client.query(sql.transactions.rollback).then(noop, (rollbackError) => rollbackError);
      throw err;
    } finally {
      client.removeListener('error', noop);
      client.release(releaseError);
    }
  }

  /** @returns {Promise<Projection[]>} */
  async getProjections() {
    return this.withTransaction(async (tx) => {
      const { rows } = await tx.query(sql.projections.list);
      return rows.map(toProjection);
    });
  }

  /**
   * @param {string} name
   * @param {number} version
   * @returns {Promise<Projection | undefined>}
   */
  async getProjection(name, version) {
    return this.withTransaction(async (tx) => {
      const { rows } = await tx.query(sql.projections.get, [name, version]);
      return rows.map(toProjection)[0];
    });
  }

  /**
   * @param {Projection} projection
   * @returns {Promise<ChangeSet[]>}
   */
  async getChangeLog(projection, { since = 0 } = {}) {
    return this.withTransaction(async (tx) => {
      const { rows } = await tx.query(sql.changeSets.listChangeLog, [projection.id, since]);
      return rows.map(toChangeSet);
    });
  }

  /**
   * @param {Projection} projection
   * @returns {Promise<ChangeSet | undefined>}
   */
  async getCurrentChangeSet(projection) {
    return this.withTransaction(async (tx) => {
      const { rows } = await tx.query(sql.changeSets.getCurrent, [projection.id]);
      return rows.map(toChangeSet)[0];
    });
  }

  /**
   * @param {number} changeSetId
   * @returns {Promise<ChangeSet | undefined>}
   */
  async getChangeSet(changeSetId) {
    return this.withTransaction(async (tx) => {
      const { rows } = await tx.query(sql.changeSets.get, [changeSetId]);
      return rows.map(toChangeSet)[0];
    });
  }

  /** @returns {Promise<NotificationStatus>} */
  async getNotificationStatus() {
    return this.#notifier.getStatus();
  }

  /**
   * @template T
   * @param {number} changeSetId
   * @param {string} entityName
   * @param {number} entityVersion
   * @returns {Promise<T[]>}
   */
  async getAggregates(changeSetId, entityName, entityVersion) {
    return this.withTransaction(async (tx) => {
      const functionName = aggregate(entityName, entityVersion);
      const { rowCount: functionExists } = await tx.query(sql.functions.checkExists, [functionName]);
      if (!functionExists) throw new Error(`Function '${functionName}' does not exist`);
      const { rowCount: changeSetExists } = await tx.query(sql.changeSets.checkExists, [changeSetId]);
      if (!changeSetExists) throw new Error(`Change set ${changeSetId} does not exist`);
      const { rows } = await tx.query(`SELECT * FROM ${escapeIdentifier(functionName)}($1)`, [changeSetId]);
      const { rows: known } = await tx.query(sql.entities.listAggregateFields, [functionName, changeSetId]);
      return rows.map((row) => Object.fromEntries(known.map(({ name: field }) => [field, row[field]])));
    });
  }

  /**
   * @template T
   * @param {Projection} projection
   * @param {number} changeSetId
   * @param {DocumentOptions} [options]
   * @returns {Promise<Documents<T>>}
   */
  async getDocuments(projection, changeSetId, options) {
    return this.withTransaction((tx) => getDocuments(tx, projection, changeSetId, options));
  }

  /**
   * @param {Request} request
   * @param {FetchOptions} [options]
   * @returns {Promise<Response>}
   */
  async fetchProjections(request, options) {
    return fetchProjections(this, request, options, getDocuments);
  }

  /**
   * @param {Request} request
   * @param {FetchOptions} [options]
   * @returns {Promise<Response>}
   */
  async fetchDeclarations(request, options) {
    return fetchDeclarations(this, request, options);
  }

  /**
   * @param {Request} request
   * @param {FetchOptions} [options]
   * @returns {Promise<Response>}
   */
  async fetchStatus(request, options) {
    return fetchStatus(this, request, options, { maxAttempts: this.#maxAttempts, subscribers: (name) => this.#emitter.listenerCount(name) });
  }

  /**
   * @param {Projection} projection
   * @returns {Promise<Bundle>}
   */
  async export(projection) {
    const types = { getTypeParser: (oid, format) => LOCAL_DATE_PARSERS.get(oid) ?? this.#types.getTypeParser(oid, format) };
    return exportBundle(this, projection, (...args) => this.withTransaction((tx) => getDocuments({ query: (text, values) => tx.query({ text, values, types }) }, ...args)));
  }

  get #maxAttempts() {
    return this.#config.notifications?.maxAttempts ?? 10;
  }

  async #begin(client) {
    if (!this.#initialised) return client.query(sql.transactions.begin);
    const [, { rows }] = await client.query(`${sql.transactions.begin}; ${sql.types.listEnumArrayTypes}`);
    registerEnumArrayParsers(this.#types, rows);
  }

  #emitNotificationError({ error, notification }, event = Filby.NOTIFICATION_ERROR) {
    try {
      this.#emitter.emit(event, { error, notification });
    } catch {}
  }
}

function noop() {}

export { Filby };
