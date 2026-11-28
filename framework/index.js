import { Filby } from './lib/Filby.js';

/**
 * @typedef {import('pg').PoolConfig} PoolConfig
 *
 * @typedef {object} Config
 * @property {PoolConfig} [database]
 * @property {'string' | 'pg'} [localDateTypes]
 * @property {string[]} [migrations]
 * @property {object} [notifications]
 * @property {string} [notifications.interval]
 * @property {string} [notifications.initialDelay]
 * @property {number} [notifications.maxAttempts]
 * @property {string} [notifications.maxRescheduleDelay]
 * @property {string} [notifications.handlerTimeout]
 * @property {boolean} [notifications.listen]
 *
 * @typedef {object} HandlerContext
 * @property {AbortSignal} signal
 *
 * @typedef {object} Projection
 * @property {number} id
 * @property {string} name
 * @property {number} version
 * @property {string} key
 *
 * @typedef {object} DocumentOptions
 * @property {Record<string, unknown>} [parameters]
 * @property {number} [pageOffset]
 * @property {number} [pageSize]
 *
 * @typedef {object} FetchOptions
 * @property {string} [basePath]
 * @property {object} [info]
 * @property {string} info.title
 * @property {string} info.version
 * @property {string} [info.description]
 *
 * @typedef {object} ChangeSet
 * @property {number} id
 * @property {Date} effective
 * @property {string} description
 * @property {Date} lastModified
 * @property {string} entityTag
 * @property {number} [reissuedFrom]
 *
 * @typedef {object} Hook
 * @property {string} name
 * @property {string} event
 *
 * @typedef {object} Notification
 * @property {number} id
 * @property {Hook} hook
 * @property {Omit<Projection, 'id'>} projection
 * @property {number} attempts
 *
 * @typedef {object} NotificationError
 * @property {Error} error
 * @property {Notification} [notification]
 *
 * @typedef {object} MaxAttemptsExhausted
 * @property {Error} error
 * @property {Notification} notification
 *
 * @typedef {object} NotificationStatus
 * @property {boolean} started
 * @property {'idle' | 'running' | 'stopped'} [poller]
 * @property {Date} [lastSuccessfulPollAt]
 * @property {number} failuresSinceLastSuccess
 * @property {{ at: Date, message: string }} [lastError]
 * @property {number} pending
 * @property {number} claimed
 * @property {number} overdue
 * @property {number} exhausted
 *
 * @typedef {object} Entity
 * @property {string} name
 * @property {number} version
 *
 * @typedef {object} BundleChangeSet
 * @property {number} id
 * @property {string} effective
 * @property {string} description
 * @property {string} lastModified
 * @property {string} entityTag
 * @property {number} [reissuedFrom]
 *
 * @typedef {object} Bundle
 * @property {1} format
 * @property {string} filby
 * @property {string} name
 * @property {number} version
 * @property {string | null} description
 * @property {Record<string, unknown>} schema
 * @property {BundleChangeSet[]} changeSets
 * @property {Record<string, Record<string, unknown>[]>} documents
 */

/**
 * @template T
 * @typedef {object} Documents
 * @property {T[]} documents
 * @property {number} total
 */

export {
  Filby,
};
