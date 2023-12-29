const createError = require('http-errors');
const { getParks, getPark } = require('./schemas');

module.exports = (fastify, { db }, done) => {

	fastify.get('/', { schema: getParks }, async (request, reply) => {
		const changeSet = await getChangeSet(request);
		const parks = await db.getParks(changeSet);

		reply.headers({
			'Last-Modified': changeSet.lastModified,
			'ETag': changeSet.eTag,
			'Cache-Control': 'max-age=31536000, immutable',
		});

		return parks;
	});

	fastify.get('/:code', { schema: getPark }, async (request, reply) => {
		const changeSet = await getChangeSet(request);
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

	async function getChangeSet(request) {
		const changeSetId = parseInt(request.query.changeSetId, 10)
		const changeSet = await db.getChangeSet(changeSetId);
		if (!changeSet) throw createError(400, `Invalid changeSetId`)
		return changeSet;
	}

	done();
}

