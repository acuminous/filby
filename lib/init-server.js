const path = require('node:path');
const swagger = require('@fastify/swagger');
const swaggerUI = require('@fastify/swagger-ui');

const fastify = require('fastify');

async function initServer(db, notifications) {
	const server = fastify({ logger: true });

	server.addHook('onClose', async () => {
		await notifications.stop();
	  await db.close();
	})

	await server.register(swagger, {
	  swagger: {
	    info: {
	      title: 'Reference Data',
	      description: 'A proof of concept reference data application',
	      version: '0.1.0'
	    },
	    schemes: ['http'],
	    consumes: ['application/json'],
	    produces: ['application/json'],
	  }
	});

	await server.register(swaggerUI, {
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

	await registerProjections(server, db);

	await server.ready()
	server.swagger()

	return server;
}

async function registerProjections(server, db) {
	const projections = await db.getProjections();
	projections.forEach(({ name, version }) => {
		const route = require(path.resolve(`routes/${name}-v${version}`));
		server.register(route, { prefix: `/api/v${version}/${name}`, db })
	});
}

module.exports = initServer;
