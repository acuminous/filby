import { strictEqual as eq, deepEqual as deq } from 'node:assert';
import { describe, it, before, beforeEach, afterEach, after } from 'node:test';
import { Validator } from '@seriousme/openapi-schema-validator';
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

import TestFilby from './TestFilby.js';
import { until } from './until.js';

const config = {
  notifications: {
    initialDelay: '0ms',
    interval: '100ms',
    maxAttempts: 3,
    maxRescheduleDelay: '100ms',
  },
};

describe('Status', () => {

  let filby;

  before(async () => {
    filby = new TestFilby(config);
    await filby.reset();
  });

  beforeEach(async () => {
    filby.unsubscribeAll();
    await filby.wipe();
    await filby.withTransaction(async (tx) => {
      await tx.query(`INSERT INTO fby_projection (id, name, version) VALUES
        (1, 'Parks', 1),
        (2, 'Parks', 2),
        (3, 'VAT Rates', 1)`);
    });
  });

  afterEach(async () => {
    filby.unsubscribeAll();
    await filby.stopNotifications();
  });

  after(async () => {
    await filby.stop();
  });

  describe('Routing', () => {

    it('should respond with 404 for an unknown path', async () => {
      const response = await get('/wombats');
      eq(response.status, 404);
      deq(await response.json(), { error: 'No route for /wombats' });
    });

    it('should respond with 405 for a method other than GET or HEAD on a known path', async () => {
      const response = await filby.fetchStatus(new Request('http://localhost/hooks', { method: 'POST' }));
      eq(response.status, 405);
      eq(response.headers.get('Allow'), 'GET, HEAD');
      deq(await response.json(), { error: 'Method POST is not allowed' });
    });

    it('should respond to HEAD requests with the status and headers of GET and no body', async () => {
      await addHooks([1, 'data-lake/add-change-set/*', 'ADD_CHANGE_SET', null]);
      const expected = await get('/hooks/data-lake%2Fadd-change-set%2F*');

      const response = await filby.fetchStatus(new Request('http://localhost/hooks/data-lake%2Fadd-change-set%2F*', { method: 'HEAD' }));
      eq(response.status, 200);
      deq([...response.headers], [...expected.headers]);
      eq(await response.text(), '');
    });

    it('should serve routes relative to the base path', async () => {
      await addHooks([1, 'data-lake', 'ADD_CHANGE_SET', null]);

      eq((await get('/status/hooks', { basePath: '/status' })).status, 200);
      eq((await get('/status/hooks/data-lake', { basePath: '/status/' })).status, 200);
      eq((await get('/status/openapi.json', { basePath: '/status' })).status, 200);
      eq((await get('/hooks', { basePath: '/status' })).status, 404);
    });

    it('should respond with JSON that caches must not store', async () => {
      await addHooks([1, 'data-lake', 'ADD_CHANGE_SET', null]);

      for (const route of ['/hooks', '/hooks/data-lake', '/openapi.json']) {
        const response = await get(route);
        eq(response.headers.get('Content-Type'), 'application/json', route);
        eq(response.headers.get('Cache-Control'), 'no-store', route);
      }
    });
  });

  describe('Hooks', () => {

    it('should list every hook by name with the projection it is limited to', async () => {
      await addHooks(
        [1, 'sns/commence-change-set/parks-v1', 'COMMENCE_CHANGE_SET', 1],
        [2, 'audit/add-projection', 'ADD_PROJECTION', null],
        [3, 'data-lake/add-change-set/*', 'ADD_CHANGE_SET', null],
      );

      const response = await get('/hooks');
      eq(response.status, 200);
      deq(await response.json(), [
        { name: 'audit/add-projection', event: 'ADD_PROJECTION', projection: null, subscribers: 0, deliveries: [] },
        { name: 'data-lake/add-change-set/*', event: 'ADD_CHANGE_SET', projection: null, subscribers: 0, deliveries: [] },
        { name: 'sns/commence-change-set/parks-v1', event: 'COMMENCE_CHANGE_SET', projection: { name: 'Parks', version: 1 }, subscribers: 0, deliveries: [] },
      ]);
    });

    it('should respond with an empty list when there are no hooks', async () => {
      deq(await (await get('/hooks')).json(), []);
    });

    it('should report a delivered notification as the last delivery, with nothing pending', async () => {
      await addHooks([1, 'data-lake/add-change-set/*', 'ADD_CHANGE_SET', null]);
      await addNotifications({ hook: 1, projection: ['Parks', 1] });
      filby.subscribe('data-lake/add-change-set/*', () => {});

      await filby.startNotifications();
      await until(async () => (await getNotifications())[0]?.status === 'OK');
      const [{ last_attempted }] = await getNotifications();

      deq((await getHook('data-lake/add-change-set/*')).deliveries, [
        { projection: { name: 'Parks', version: 1 }, lastDelivered: last_attempted.toISOString(), pending: [] },
      ]);
    });

    it('should report a failing notification with its attempts but not its error', async () => {
      await addHooks([1, 'data-lake/add-change-set/*', 'ADD_CHANGE_SET', null]);
      await addNotifications(
        { hook: 1, projection: ['Parks', 1], status: 'OK', attempts: 1, lastAttempted: '2026-11-20T09:14:03Z' },
        { hook: 1, projection: ['Parks', 1], status: 'PENDING', attempts: 2, scheduledFor: '2026-11-23T10:02:16Z', lastAttempted: '2026-11-23T10:02:00Z', lastError: 'Error: POST https://example.com responded with 503\n    at secret' },
      );

      deq(await getHook('data-lake/add-change-set/*'), {
        name: 'data-lake/add-change-set/*',
        event: 'ADD_CHANGE_SET',
        projection: null,
        subscribers: 0,
        deliveries: [
          {
            projection: { name: 'Parks', version: 1 },
            lastDelivered: '2026-11-20T09:14:03.000Z',
            pending: [
              { status: 'PENDING', scheduledFor: '2026-11-23T10:02:16.000Z', attempts: 2, lastAttempted: '2026-11-23T10:02:00.000Z', exhausted: false },
            ],
          },
        ],
      });
    });

    it('should report a notification that has not been attempted', async () => {
      await addHooks([1, 'data-lake/add-change-set/*', 'ADD_CHANGE_SET', null]);
      await addNotifications({ hook: 1, projection: ['Parks', 1], scheduledFor: '2026-11-23T10:02:16Z' });

      deq((await getHook('data-lake/add-change-set/*')).deliveries, [
        {
          projection: { name: 'Parks', version: 1 },
          lastDelivered: null,
          pending: [{ status: 'PENDING', scheduledFor: '2026-11-23T10:02:16.000Z', attempts: 0, lastAttempted: null, exhausted: false }],
        },
      ]);
    });

    it('should report a pending notification as exhausted once it has reached the maximum attempts', async () => {
      await addHooks(
        [1, 'a/add-change-set', 'ADD_CHANGE_SET', null],
        [2, 'b/add-change-set', 'ADD_CHANGE_SET', null],
        [3, 'c/add-change-set', 'ADD_CHANGE_SET', null],
      );
      await addNotifications(
        { hook: 1, projection: ['Parks', 1], attempts: 2, lastAttempted: '2026-11-23T10:02:00Z' },
        { hook: 2, projection: ['Parks', 1], attempts: 3, lastAttempted: '2026-11-23T10:02:00Z' },
        { hook: 3, projection: ['Parks', 1], status: 'CLAIMED', attempts: 3, lastAttempted: '2026-11-23T10:02:00Z' },
      );

      const exhausted = (await (await get('/hooks')).json()).map(({ name, deliveries }) => [name, deliveries[0].pending[0].exhausted]);
      deq(exhausted, [
        ['a/add-change-set', false],
        ['b/add-change-set', true],
        ['c/add-change-set', false],
      ]);
    });

    it('should compare attempts with the default maximum when none is configured', async () => {
      const unconfigured = new TestFilby({});
      try {
        await addHooks(
          [1, 'a/add-change-set', 'ADD_CHANGE_SET', null],
          [2, 'b/add-change-set', 'ADD_CHANGE_SET', null],
        );
        await addNotifications(
          { hook: 1, projection: ['Parks', 1], attempts: 9 },
          { hook: 2, projection: ['Parks', 1], attempts: 10 },
        );

        const response = await unconfigured.fetchStatus(new Request('http://localhost/hooks'));
        deq((await response.json()).map(({ deliveries }) => deliveries[0].pending[0].exhausted), [false, true]);
      } finally {
        await unconfigured.stop();
      }
    });

    it('should list each future change set of a COMMENCE_CHANGE_SET hook in scheduled order', async () => {
      await addHooks([1, 'sns/commence-change-set/parks-v1', 'COMMENCE_CHANGE_SET', 1]);
      await addNotifications(
        { hook: 1, projection: ['Parks', 1], scheduledFor: '2027-01-01T00:00:00Z' },
        { hook: 1, projection: ['Parks', 1], scheduledFor: '2026-12-01T00:00:00Z' },
      );

      deq((await getHook('sns/commence-change-set/parks-v1')).deliveries, [
        {
          projection: { name: 'Parks', version: 1 },
          lastDelivered: null,
          pending: [
            { status: 'PENDING', scheduledFor: '2026-12-01T00:00:00.000Z', attempts: 0, lastAttempted: null, exhausted: false },
            { status: 'PENDING', scheduledFor: '2027-01-01T00:00:00.000Z', attempts: 0, lastAttempted: null, exhausted: false },
          ],
        },
      ]);
    });

    it('should report a delivery for each projection by name then version', async () => {
      await addHooks([1, 'data-lake/add-change-set/*', 'ADD_CHANGE_SET', null]);
      await addNotifications(
        { hook: 1, projection: ['VAT Rates', 1], status: 'OK', lastAttempted: '2026-11-21T00:00:00Z' },
        { hook: 1, projection: ['Parks', 2], status: 'CLAIMED', attempts: 1, scheduledFor: '2026-11-22T00:00:00Z', lastAttempted: '2026-11-22T00:00:01Z' },
        { hook: 1, projection: ['Parks', 1], status: 'OK', lastAttempted: '2026-11-20T00:00:00Z' },
      );

      deq((await getHook('data-lake/add-change-set/*')).deliveries, [
        { projection: { name: 'Parks', version: 1 }, lastDelivered: '2026-11-20T00:00:00.000Z', pending: [] },
        {
          projection: { name: 'Parks', version: 2 },
          lastDelivered: null,
          pending: [{ status: 'CLAIMED', scheduledFor: '2026-11-22T00:00:00.000Z', attempts: 1, lastAttempted: '2026-11-22T00:00:01.000Z', exhausted: false }],
        },
        { projection: { name: 'VAT Rates', version: 1 }, lastDelivered: '2026-11-21T00:00:00.000Z', pending: [] },
      ]);
    });

    it('should count the handlers subscribed to the hook on this instance', async () => {
      await addHooks(
        [1, 'a/add-change-set', 'ADD_CHANGE_SET', null],
        [2, 'b/add-change-set', 'ADD_CHANGE_SET', null],
      );
      filby.subscribe('a/add-change-set', () => {});
      filby.subscribe('a/add-change-set', () => {});

      deq((await (await get('/hooks')).json()).map(({ subscribers }) => subscribers), [2, 0]);
      eq((await getHook('a/add-change-set')).subscribers, 2);

      filby.unsubscribe('a/add-change-set');
      eq((await getHook('a/add-change-set')).subscribers, 0);
    });

    it('should respond with 404 for a hook that does not exist', async () => {
      const response = await get('/hooks/data-lake%2Fadd-change-set%2F*');
      eq(response.status, 404);
      deq(await response.json(), { error: "Hook 'data-lake/add-change-set/*' does not exist" });
    });

    it('should respond with 400 for a hook name that cannot be URL-decoded', async () => {
      const response = await get('/hooks/%E0%A4%A');
      eq(response.status, 400);
      deq(await response.json(), { error: "Malformed hook name '%E0%A4%A'" });
    });
  });

  describe('OpenAPI', () => {

    it('should serve a document that validates against the OpenAPI 3.1 schema', async () => {
      const response = await get('/status/openapi.json', { basePath: '/status', info: { title: 'Operations', version: '2.0.0' } });
      eq(response.status, 200);
      const document = await response.json();
      deq(document.info, { title: 'Operations', version: '2.0.0' });
      deq(document.servers, [{ url: '/status' }]);
      deq(Object.keys(document.paths), ['/hooks', '/hooks/{name}']);
      const { valid, errors } = await new Validator().validate(document);
      deq(errors, undefined);
      eq(valid, true);
    });

    it('should describe the responses of the hook routes', async () => {
      await addHooks(
        [1, 'sns/commence-change-set/parks-v1', 'COMMENCE_CHANGE_SET', 1],
        [2, 'data-lake/add-change-set/*', 'ADD_CHANGE_SET', null],
      );
      await addNotifications(
        { hook: 1, projection: ['Parks', 1], scheduledFor: '2027-01-01T00:00:00Z' },
        { hook: 2, projection: ['Parks', 1], status: 'OK', attempts: 1, lastAttempted: '2026-11-20T09:14:03Z' },
        { hook: 2, projection: ['Parks', 1], status: 'CLAIMED', attempts: 1, lastAttempted: '2026-11-23T10:02:00Z' },
      );

      const document = await (await get('/openapi.json')).json();
      const ajv = new Ajv({ strict: false });
      addFormats(ajv);
      ajv.addSchema({ $id: 'status', ...document });
      const list = ajv.compile({ type: 'array', items: { $ref: 'status#/components/schemas/HookStatus' } });
      const hook = ajv.compile({ $ref: 'status#/components/schemas/HookStatus' });

      const hooks = await (await get('/hooks')).json();
      eq(list(hooks), true, JSON.stringify(list.errors));
      eq(hook(await getHook('data-lake/add-change-set/*')), true, JSON.stringify(hook.errors));
      eq(hook({ ...hooks[0], extra: true }), false);
    });
  });

  async function addHooks(...hooks) {
    await filby.withTransaction(async (tx) => {
      for (const [id, name, event, projectionId] of hooks) {
        await tx.query('INSERT INTO fby_hook (id, name, event, projection_id) VALUES ($1, $2, $3, $4)', [id, name, event, projectionId]);
      }
    });
  }

  async function addNotifications(...notifications) {
    await filby.withTransaction(async (tx) => {
      for (const { hook, projection: [name, version], status = 'PENDING', attempts = 0, scheduledFor = new Date(), lastAttempted = null, lastError = null } of notifications) {
        await tx.query(`INSERT INTO fby_notification (hook_id, projection_name, projection_version, status, attempts, scheduled_for, last_attempted, last_error)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [hook, name, version, status, attempts, scheduledFor, lastAttempted, lastError]);
      }
    });
  }

  async function getNotifications() {
    const { rows } = await filby.withTransaction((tx) => tx.query('SELECT * FROM fby_notification ORDER BY id'));
    return rows;
  }

  async function getHook(name) {
    const response = await get(`/hooks/${encodeURIComponent(name)}`);
    eq(response.status, 200);
    return response.json();
  }

  async function get(route, options) {
    return filby.fetchStatus(new Request(`http://localhost${route}`), options);
  }
});
