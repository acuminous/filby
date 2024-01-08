import path from 'node:path';

import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';
import axios from 'axios';

import config from './config.json';
import changeLogRoute from './routes/changelog-v1';
import Filby, { Projection, Event } from '../..';

const fastify = Fastify(config.fastify);

const filby = new Filby({ ...config.filby, ...{ database: config.database } });

type AppProcess = NodeJS.Process & {
  emit(event: string): boolean;
};

const app: AppProcess = process;

(async () => {

  await fastify.register(swagger, {
    swagger: {
      info: {
        title: 'Holiday Park Data Service',
        description: 'A proof of concept Filby application',
        version: '1.0.0'
      },
      schemes: ['http'],
      consumes: ['application/json'],
      produces: ['application/json'],
    }
  });

  await fastify.register(swaggerUI, {
    routePrefix: '/documentation',
    uiConfig: {
      docExpansion: 'full',
      deepLinking: false
    },
    uiHooks: {
      onRequest: function (request, reply, next) { next() },
      preHandler: function (request, reply, next) { next() }
    },
    staticCSP: true,
    transformStaticCSP: (header) => header,
    transformSpecification: (swaggerObject, request, reply) => { return swaggerObject },
    transformSpecificationClone: true
  });

  try {
    await filby.init();

    await registerChangelog();
    await registerProjections();

    await fastify.listen(config.server);

    filby.on('park_v1_change', async (event: Event) => {
      await axios.post('https://httpbin.org/status/200', event);
    });
    filby.on('change', async (event: Event) => {
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
    process.exit(1)
  }
})();

async function registerChangelog() {
  fastify.register(changeLogRoute, { prefix: '/api/changelog', filby });
}

async function registerProjections() {
  const projections = await filby.getProjections();
  projections.forEach((projection: Projection) => {
    const route = require(path.resolve(`routes/${projection.name}-v${projection.version}`));
    const prefix = `/api/projection/v${projection.version}/${projection.name}`;
    fastify.register(route, { prefix, filby });
  })
}

function registerShutdownHooks() {
  app.once('SIGINT', () => app.emit('app_stop'));
  app.once('SIGTERM', () => app.emit('app_stop'));
  app.once('app_stop', async () => {
    app.removeAllListeners('app_stop');
    await filby.stopNotifications();
    await fastify.close();
    await filby.stop();
    console.log('Server has stopped');
  })
}
