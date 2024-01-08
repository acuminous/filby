const path = require('node:path');

const Fastify = require('fastify');
const swagger = require('@fastify/swagger');
const swaggerUI = require('@fastify/swagger-ui');
const axios = require('axios');

const config = require('./config.json');
const changeLogRoute = require('./routes/changelog-v1');
const Filby = require('../..');

const fastify = Fastify(config.fastify);

const filby = new Filby({ ...config.filby, ...{ database: config.database } });

(async () => {

  await fastify.register(swagger, {
    swagger: {
      info: {
        title: 'Holiday Park Data Service',
        description: 'A proof of concept Filby application',
        version: '1.0.0',
      },
      schemes: ['http'],
      consumes: ['application/json'],
      produces: ['application/json'],
    },
  });

  await fastify.register(swaggerUI, {
    routePrefix: '/documentation',
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

  try {
    await filby.init();

    await registerChangelog();
    await registerProjections();

    await fastify.listen(config.server);

    filby.on('park_v1_change', async (event) => {
      await axios.post('https://httpbin.org/status/200', event);
    });
    filby.on('change', async (event) => {
      // Demonstrate a webhook with retry behaviour
      await axios.post('https://httpbin.org/status/500', event);
    });
    await filby.startNotifications();

    registerShutdownHooks();
    console.log(`Server is listening on port ${config.server?.port}`);
    console.log(`See http://localhost:${config.server?.port}/documentation`);
    console.log(`Use CTRL+D or kill -TERM ${process.pid} to stop`);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();

async function registerChangelog() {
  fastify.register(changeLogRoute, { prefix: '/api/changelog', filby });
}

async function registerProjections() {
  const projections = await filby.getProjections();
  projections.forEach((projection) => {
    // eslint-disable-next-line global-require
    const route = require(path.resolve(`routes/${projection.name}-v${projection.version}`));
    const prefix = `/api/projection/v${projection.version}/${projection.name}`;
    fastify.register(route, { prefix, filby });
  });
}

function registerShutdownHooks() {
  process.once('SIGINT', () => process.emit('app_stop'));
  process.once('SIGTERM', () => process.emit('app_stop'));
  process.once('app_stop', async () => {
    process.removeAllListeners('app_stop');
    await filby.stopNotifications();
    await fastify.close();
    await filby.stop();
    console.log('Server has stopped');
  });
}
