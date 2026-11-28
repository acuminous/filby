import { HttpError, decode } from '../handler.js';
import { STRING, INTEGER, CACHE_CONTROL_HEADERS, object, response, errorResponse } from '../openapi.js';
import { sql } from '../../database/sql.js';

const DATE_TIME = { type: 'string', format: 'date-time' };
const PROJECTION_REFERENCE = { $ref: '#/components/schemas/ProjectionReference' };

const routes = [
  [/^\/hooks$/, listHooks],
  [/^\/hooks\/([^/]+)$/, getHook],
];

const paths = {
  '/hooks': {
    get: {
      operationId: 'listHookStatus',
      summary: 'Hook delivery status',
      description: 'The delivery status of every hook, ordered by name',
      responses: {
        200: response('The hooks', { type: 'array', items: { $ref: '#/components/schemas/HookStatus' } }, CACHE_CONTROL_HEADERS),
      },
    },
  },
  '/hooks/{name}': {
    get: {
      operationId: 'getHookStatus',
      summary: 'Hook delivery status',
      description: 'The delivery status of one hook',
      parameters: [
        { name: 'name', in: 'path', required: true, description: 'The hook name, URL-encoded', schema: STRING },
      ],
      responses: {
        200: response('The hook', { $ref: '#/components/schemas/HookStatus' }, CACHE_CONTROL_HEADERS),
        400: errorResponse('A hook name that cannot be URL-decoded'),
        404: errorResponse('The hook does not exist'),
      },
    },
  },
};

const schemas = {
  HookStatus: object({
    name: STRING,
    event: { enum: ['ADD_PROJECTION', 'DROP_PROJECTION', 'ADD_CHANGE_SET', 'COMMENCE_CHANGE_SET'] },
    projection: { anyOf: [PROJECTION_REFERENCE, { type: 'null' }] },
    subscribers: INTEGER,
    deliveries: { type: 'array', items: { $ref: '#/components/schemas/HookDelivery' } },
  }),
  HookDelivery: object({
    projection: PROJECTION_REFERENCE,
    lastDelivered: { anyOf: [DATE_TIME, { type: 'null' }] },
    pending: { type: 'array', items: { $ref: '#/components/schemas/PendingNotification' } },
  }),
  PendingNotification: object({
    status: { enum: ['PENDING', 'CLAIMED'] },
    scheduledFor: DATE_TIME,
    attempts: INTEGER,
    lastAttempted: { anyOf: [DATE_TIME, { type: 'null' }] },
    exhausted: { type: 'boolean' },
  }),
};

async function listHooks(filby, _, instance) {
  return filby.withTransaction((tx) => loadHooks(tx, instance));
}

async function getHook(filby, [, encoded], instance) {
  const name = decode(encoded, 'hook');
  const [hook] = await filby.withTransaction((tx) => loadHooks(tx, instance, name));
  if (!hook) throw new HttpError(404, `Hook '${name}' does not exist`);
  return hook;
}

async function loadHooks(tx, { maxAttempts, subscribers }, name) {
  const { rows: hooks } = await tx.query(sql.hooks.listStatus, [name ?? null]);
  const { rows: notifications } = await tx.query(sql.notifications.listForHooks, [hooks.map(({ id }) => id)]);
  return hooks.map((hook) => ({
    name: hook.name,
    event: hook.event,
    projection: hook.projection_name === null ? null : { name: hook.projection_name, version: hook.projection_version },
    subscribers: subscribers(hook.name),
    deliveries: toDeliveries(notifications.filter(({ hook_id }) => hook_id === hook.id), maxAttempts),
  }));
}

function toDeliveries(notifications, maxAttempts) {
  const deliveries = new Map();
  for (const notification of notifications) {
    const key = JSON.stringify([notification.projection_name, notification.projection_version]);
    if (!deliveries.has(key)) deliveries.set(key, { projection: { name: notification.projection_name, version: notification.projection_version }, lastDelivered: null, pending: [] });
    const delivery = deliveries.get(key);
    if (notification.status === 'OK') delivery.lastDelivered = notification.last_attempted;
    else delivery.pending.push(toPending(notification, maxAttempts));
  }
  return [...deliveries.values()];
}

function toPending({ status, scheduled_for, attempts, last_attempted }, maxAttempts) {
  return { status, scheduledFor: scheduled_for, attempts, lastAttempted: last_attempted, exhausted: status === 'PENDING' && attempts >= maxAttempts };
}

export { routes, paths, schemas };
