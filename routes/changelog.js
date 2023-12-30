const createError = require('http-errors');
const { changelog } = require('./schemas');

module.exports = (fastify, { db }, done) => {

	fastify.get('/rdf/v1/changelog', { schema: changelog }, async (request, reply) => {

		const projection = await getProjection(request)

		const changeLog = await db.getChangeLog(projection);
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
		const projection = await db.getProjection(name, version);
		if (!projection) throw createError(404, `Projection not found: ${name}-v${version}`);
		return projection;
	}

	done();
}

