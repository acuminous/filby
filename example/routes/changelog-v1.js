const createError = require('http-errors');
const schemas = require('./changelog-v1-schemas');

module.exports = (fastify, { rdf }, done) => {

	fastify.get('/', { schema: schemas.changelog, rdf }, async (request, reply) => {

		const projection = await getProjection(request)

		const changeLog = await rdf.getChangeLog(projection);
		if (changeLog.length === 0) throw createError(404, `Projection ${projection.name}-v${projection.version} has no change sets`);

		const changeSet = changeLog[changeLog.length - 1];

		reply.headers({
			'Last-Modified': changeSet.lastModified,
			'ETag': changeSet.eTag,
			'Cache-Control': 'max-age=600, stale-while-revalidate=600, stale-if-error=86400',
		});

		return changeLog;
	});

	async function getProjection(request) {
		const name = request.query.projection;
		const version = parseInt(request.query.version, 10);
		const projection = await rdf.getProjection(name, version);
		if (!projection) throw createError(404, `Projection not found: ${name}-v${version}`);
		return projection;
	}

	done();
}

