const path = require('node:path');

const Fastify = require('fastify');
const swagger = require('@fastify/swagger');
const swaggerUI = require('@fastify/swagger-ui');
const cors = require('@fastify/cors');
const axios = require('axios');

const pkg = require('../package.json');
const Filby = require('../../..');
const changeLogRoute = require('./routes/changelog-v1');

module.exports = class Application {

  #config;
  #logger;
  #fastify;
  #filby;

  constructor({ config }) {
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
    this.#filby.subscribe(Filby.HOOK_MAX_ATTEMPTS_EXHAUSTED, async (notification) => {
      this.#logger.error('Hook failed', notification);
      this.#logger.error(notification.err.stack);
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

  async #registerWebhook(event, url) {
    this.#filby.subscribe(event, async (context) => {
      await axios.post(url, context);
    });
  }

  async #initFastify() {
    await this.#fastify.register(cors, {
      origin: '*',
      methods: ['GET'],
    });
    await this.#registerSwagger();
    await this.#registerChangelog();
    await this.#registerProjections();
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
      await this.#registerProjection(projections[i]);
    }
  }

  async #registerProjection(projection) {
    const routePath = path.resolve(path.join('lib', 'routes', `${projection.name}-v${projection.version}`));
    // eslint-disable-next-line global-require
    const route = require(routePath);
    const prefix = `/api/projection/v${projection.version}/${projection.name}`;
    await this.#fastify.register(route, { prefix, projection, filby: this.#filby });
  }
};
