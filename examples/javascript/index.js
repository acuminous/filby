const path = require('node:path');

const config = require('./config');
const Fastify = require('fastify');
const swagger = require('@fastify/swagger');
const swaggerUI = require('@fastify/swagger-ui');

const changeLogRoute = require('./routes/changelog-v1');
const ReferenceDataFramework = require('../..');

const fastify = Fastify(config.fastify);

const rdf = new ReferenceDataFramework({ ...config.rdf, ...{ database: config.database } });

(async () => {

	await fastify.register(swagger, {
		swagger: {
			info: {
				title: 'Holiday Park Data Service',
				description: 'A proof of concept reference data application',
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
			onRequest: function (_, __, next) { next(); },
			preHandler: function (_, __, next) { next(); }
		},
		staticCSP: true,
		transformStaticCSP: (header) => header,
		transformSpecification: (swaggerObject) => { return swaggerObject; },
		transformSpecificationClone: true
	});

	try {
		await rdf.init();

		await registerChangelog();
		await registerProjections();

		await fastify.listen(config.server);

		rdf.on('park_v1_change', (event) => {
			console.log({ event });
		});
		rdf.on('change', (event) => {
			console.log({ event });
		});
		await rdf.startNotifications();

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
	fastify.register(changeLogRoute, { prefix: '/api/changelog', rdf });
}

async function registerProjections() {
	const projections = await rdf.getProjections();
	projections.forEach((projection) => {
		const route = require(path.resolve(`routes/${projection.name}-v${projection.version}`));
		const prefix = `/api/projection/v${projection.version}/${projection.name}`;
		fastify.register(route, { prefix, rdf });
	});
}

function registerShutdownHooks() {
	process.once('SIGINT', () => process.emit('app_stop'));
	process.once('SIGTERM', () => process.emit('app_stop'));
	process.once('app_stop', async () => {
		process.removeAllListeners('app_stop');
		await rdf.stopNotifications();
		await fastify.close();
		await rdf.stop();
		console.log('Server has stopped');
	});
}
