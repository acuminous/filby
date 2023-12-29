const createError = require('http-errors');
const { getParks, getPark } = require('./park-v1-schemas');

module.exports = (fastify, { db }, done) => {

	fastify.get('/changelog', async (request, reply) => {
		const changeLog = await db.getParkChangeLog();
		const changeSet = changeLog[changeLog.length - 1];

		reply.headers({
			'Last-Modified': changeSet.lastModified,
			'ETag': changeSet.eTag,
			'Cache-Control': 'max-age=600, stale-while-revalidate=600, stale-if-error=86400',
		});

		return changeLog;
	});

	fastify.get('/', { schema: getParks }, async (request, reply) => {
		const changeSetId = parseInt(request.query.changeSetId, 10)
		const changeSet = await getChangeSet(changeSetId);
		const parks = await db.getParks(changeSet);

		reply.headers({
			'Last-Modified': changeSet.lastModified,
			'ETag': changeSet.eTag,
			'Cache-Control': 'max-age=31536000, immutable',
		});

		return parks;
	});

	fastify.get('/:code', { schema: getPark }, async (request, reply) => {
		const changeSetId = parseInt(request.query.changeSetId, 10)
		const changeSet = await getChangeSet(changeSetId);
		const code = request.params.code;
		const park = await db.getPark(changeSet, code);
		if (!park) throw createError(404, `Park not found: ${code}`);

		reply.headers({
			'Last-Modified': changeSet.lastModified,
			'ETag': changeSet.eTag,
			'Cache-Control': 'max-age=31536000, immutable',
		});

		return park;
	});

	async function getChangeSet(changeSetId) {
		const changeSet = await db.getChangeSet(changeSetId);
		if (!changeSet) throw createError(400, `Invalid changeSetId`)
		return changeSet;
	}

	done();
}

