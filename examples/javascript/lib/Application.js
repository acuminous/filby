const { Hono } = require('hono');
const { cors } = require('hono/cors');
const { swaggerUI } = require('@hono/swagger-ui');

const { Filby } = require('../../..');
const pkg = require('../package.json');

const info = { title: pkg.title, version: pkg.version, description: pkg.description };

module.exports = class Application {

  #config;
  #filby;
  #app = new Hono();

  constructor({ config }) {
    this.#config = config;
    this.#filby = new Filby(config.filby);
    this.#app.use('/api/*', cors({ origin: '*', allowMethods: ['GET'] }));
    this.#app.get('/health', (c) => this.#getHealth(c));
    this.#app.get('/documentation', swaggerUI({ url: '/api/openapi.json' }));
    this.#app.get('/api/projections/park/v1/code/:code', (c) => this.#getPark(c));
    this.#app.all('/api/*', (c) => this.#filby.fetch(c.req.raw, { basePath: '/api', info }));
  }

  get app() {
    return this.#app;
  }

  async start() {
    await this.#filby.init();
    this.#reportFailingWebhooks();
    this.#registerWebhooks();
    await this.#filby.startNotifications();
  }

  async stop() {
    await this.#filby.stopNotifications();
    await this.#filby.stop();
  }

  async #getHealth(c) {
    const status = await this.#filby.getNotificationStatus();
    return c.json(status, status.started && status.failuresSinceLastSuccess === 0 ? 200 : 503);
  }

  async #getPark(c) {
    const projection = await this.#filby.getProjection('park', 1);
    if (!projection) return c.json({ error: "Projection 'park v1' does not exist" }, 404);
    if (!c.req.query('changeSetId')) return this.#redirectToCurrentChangeSet(c, projection);
    const changeSetId = Number(c.req.query('changeSetId'));
    const changeSet = Number.isInteger(changeSetId) ? await this.#filby.getChangeSet(changeSetId) : undefined;
    if (!changeSet) return c.json({ error: `Change set ${c.req.query('changeSetId')} does not exist` }, 400);
    const code = c.req.param('code').toUpperCase();
    const { documents: [park] } = await this.#filby.getDocuments(projection, changeSet.id, { parameters: { code } });
    if (!park) return c.json({ error: `Park '${code}' does not exist in change set ${changeSet.id}` }, 404);
    return c.json(park, 200, {
      ETag: changeSet.entityTag,
      'Last-Modified': changeSet.lastModified.toUTCString(),
      'Cache-Control': 'max-age=31536000, immutable',
    });
  }

  async #redirectToCurrentChangeSet(c, projection) {
    const changeSet = await this.#filby.getCurrentChangeSet(projection);
    if (!changeSet) return c.json({ error: `Projection '${projection.key}' has no current change set` }, 404);
    const url = new URL(c.req.url);
    url.searchParams.set('changeSetId', changeSet.id);
    return c.redirect(`${url.pathname}${url.search}`, 307);
  }

  #reportFailingWebhooks() {
    this.#filby.subscribe(Filby.HOOK_MAX_ATTEMPTS_EXHAUSTED, async ({ error, notification }) => {
      console.error(`Notification '${notification.hook.name}' for event '${notification.hook.event}' failed after ${notification.attempts} attempts and will no longer be retried`, error);
    });
  }

  #registerWebhooks() {
    for (const [event, url] of Object.entries(this.#config.webhooks)) {
      this.#filby.subscribe(event, async (notification, { signal }) => {
        const api = `/api/projections/${encodeURIComponent(notification.projection.name)}/v${notification.projection.version}`;
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...notification, api }), signal });
        if (!response.ok) throw new Error(`POST ${url} responded with ${response.status}`);
      });
    }
  }
};
