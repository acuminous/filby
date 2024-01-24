import path from 'node:path';

import Fastify, { FastifyInstance, RouteOptions } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import cors from '@fastify/cors';
import axios, { AxiosError } from 'axios';

import pkg from '../package.json';
import Filby, { Config as FilbyConfig, Projection, PoolConfig, Notification, ErrorNotification } from '../../..';
import changeLogRoute from './routes/changelog-v1';

export type ApplicationConfig = {
  database: PoolConfig;
  fastify: {
    logger: boolean;
  };
  filby: FilbyConfig;
  server: {
    port: number;
  }
  swagger: {
    prefix: string;
  }
  webhooks: {
    [key: string]: string;
  };
}

type ProjectionRouteOptions = {
  method: string;
  path: string;
  projection: Projection;
  index: boolean;
}

export default class Application {

  #config;
  #logger;
  #filby: Filby;
  #fastify: FastifyInstance;
  #routes = new Map<string, {
    location?: string,
    paths: string[]
  }>();

  constructor({ config }: { config: ApplicationConfig }) {
    this.#config = config;
    this.#filby = new Filby({ ...this.#config.filby, ...{ database: this.#config.database } });
    this.#fastify = Fastify(this.#config.fastify);
    this.#logger = this.#fastify.log;
  }

  async start() {
    await this.#initFilby();
    await this.#initFastify();
    await this.#fastify.listen(this.#config.server);
    await this.#filby.startNotifications();
  }

  async stop() {
    await this.#filby?.stopNotifications();
    await this.#fastify?.close();
    await this.#filby?.stop();
  }

  async #initFilby() {
    await this.#filby.init();
    await this.#handleHookFailures();
    await this.#regsiterWebhooks();
  }

  async #handleHookFailures() {
    this.#filby.subscribe<ErrorNotification<AxiosError>>(Filby.HOOK_MAX_ATTEMPTS_EXHAUSTED, async (errNotification: ErrorNotification<AxiosError>) => {
      const { err, ...notification } = errNotification;
      const message = `Notification '${notification.hook.name}' for event '${notification.hook.event}' failed after ${notification.attempts} attempts and will no longer be retried`;
      this.#logger.error({ notification }, message);
      const details = err.isAxiosError
        ? { message: err.message, stack: err.stack, method: err.config.method, url: err.config.url }
        : { message: err.message, stack: err.stack }
      this.#logger.error(details);
    });
  }

  async #regsiterWebhooks() {
    const events = Object.keys(this.#config.webhooks || []);
    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const url = this.#config.webhooks[event];
      this.#registerWebhook(event, url);
    }
  }

  async #registerWebhook(event: string, url: string) {
    this.#filby.subscribe(event, async (notification: Notification) => {
      const routes = this.#routes.get(notification.projection.key);
      await axios.post(url, { ...notification, routes });
    });
  }

  async #initFastify() {
    this.#fastify.addHook('onRoute', (routeOptions: RouteOptions) => this.captureProjectionPath(routeOptions as unknown as ProjectionRouteOptions));
    await this.#fastify.register(cors, { origin: '*', methods: ['GET'] });
    await this.#registerSwagger();
    await this.#registerChangelog();
    await this.#registerProjections();
  }

  captureProjectionPath(routeOptions: ProjectionRouteOptions) {
    if (routeOptions.method !== 'GET' || !routeOptions.projection) return;
    const route = this.#routes.get(routeOptions.projection.key);
    if (!route) return;
    if (routeOptions.index) route.location = routeOptions.path;
    route.paths.push(routeOptions.path);
  }

  async #registerSwagger() {
    await this.#fastify.register(swagger, {
      swagger: {
        info: {
          title: pkg.title,
          description: pkg.description,
          version: pkg.version,
        },
        schemes: ['http'],
        consumes: ['application/json'],
        produces: ['application/json'],
      },
    });

    await this.#fastify.register(swaggerUI, {
      routePrefix: this.#config.swagger.prefix,
      uiConfig: {
        docExpansion: 'full',
        deepLinking: false,
      },
      uiHooks: {
        onRequest(_, __, next) { next(); },
        preHandler(_, __, next) { next(); },
      },
      staticCSP: true,
      transformStaticCSP: (header) => header,
      transformSpecification: (swaggerObject) => swaggerObject,
      transformSpecificationClone: true,
    });
  }

  async #registerChangelog() {
    await this.#fastify.register(changeLogRoute, { prefix: '/api/changelog', filby: this.#filby });
  }

  async #registerProjections() {
    const projections = await this.#filby.getProjections();
    for (let i = 0; i < projections.length; i++) {
      this.#routes.set(projections[i].key, { paths: [] });
      await this.#registerProjection(projections[i]);
    }
  }

  async #registerProjection(projection: Projection) {
    const routePath = path.resolve(path.join('lib', 'routes', `${projection.name}-v${projection.version}`));
    // eslint-disable-next-line global-require
    const route = require(routePath);
    const prefix = `/api/projection/v${projection.version}/${projection.name}`;
    await this.#fastify.register(route, { prefix, projection, filby: this.#filby });
  }
};
