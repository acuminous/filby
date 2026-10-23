import { Context, Hono } from 'hono';
import { cors } from 'hono/cors';
import { swaggerUI } from '@hono/swagger-ui';

import { Filby, Notification, NotificationError } from '../../..';
import pkg from '../package.json';
import { ApplicationConfig } from '../config';

type ExhaustedNotification = NotificationError & { notification: Notification };

const info = { title: pkg.title, version: pkg.version, description: pkg.description };

export default class Application {

  #config: ApplicationConfig;
  #filby: Filby;
  #app = new Hono();

  constructor({ config }: { config: ApplicationConfig }) {
    this.#config = config;
    this.#filby = new Filby(config.filby);
    this.#app.use('/api/*', cors({ origin: '*', allowMethods: ['GET'] }));
    this.#app.get('/health', (c) => this.#getHealth(c));
    this.#app.get('/documentation', swaggerUI({ url: '/api/openapi.json' }));
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

  async #getHealth(c: Context) {
    const status = await this.#filby.getNotificationStatus();
    return c.json(status, status.started && status.failuresSinceLastSuccess === 0 ? 200 : 503);
  }

  #reportFailingWebhooks() {
    this.#filby.subscribe<ExhaustedNotification>(Filby.HOOK_MAX_ATTEMPTS_EXHAUSTED, async ({ error, notification }) => {
      console.error(`Notification '${notification.hook.name}' for event '${notification.hook.event}' failed after ${notification.attempts} attempts and will no longer be retried`, error);
    });
  }

  #registerWebhooks() {
    for (const [event, url] of Object.entries(this.#config.webhooks)) {
      this.#filby.subscribe<Notification>(event, async (notification, { signal }) => {
        const api = `/api/projections/${encodeURIComponent(notification.projection.name)}/v${notification.projection.version}`;
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...notification, api }), signal });
        if (!response.ok) throw new Error(`POST ${url} responded with ${response.status}`);
      });
    }
  }
}
