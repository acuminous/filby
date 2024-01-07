const createError = require('http-errors');

const getChangelogSchema = {
  querystring: {
    type: 'object',
    required: ['projection', 'version'],
    properties: {
      projection: {
        type: 'string',
      },
      version: {
        type: 'integer',
      },
    },
  },
};

module.exports = (fastify, { filby }, done) => {

  fastify.get('/', { schema: getChangelogSchema }, async (request, reply) => {

    const projection = await getProjection(request);

    const changeLog = await filby.getChangeLog(projection);
    if (changeLog.length === 0) throw createError(404, `Projection ${projection.name}-v${projection.version} has no change sets`);

    const changeSet = changeLog[changeLog.length - 1];

    reply.headers({
      'Last-Modified': changeSet.lastModified.toUTCString(),
      'ETag': changeSet.entityTag,
      'Cache-Control': 'max-age=600, stale-while-revalidate=600, stale-if-error=86400',
    });

    return changeLog;
  });

  async function getProjection(request) {
    const name = String(request.query.projection);
    const version = Number(request.query.version);
    const projection = await filby.getProjection(name, version);
    if (!projection) throw createError(404, `Projection not found: ${name}-v${version}`);
    return projection;
  }

  done();
};
