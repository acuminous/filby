const createError = require('http-errors');
const uri = require('fast-uri');

const getParksSchema = require('../../../schemas/get-parks-schema.json');
const getParkSchema = require('../../../schemas/get-park-schema.json');

module.exports = (fastify, { projection, filby }, done) => {

  fastify.get('/', { schema: getParksSchema, projection, index: true }, async (request, reply) => {
    if (request.query.changeSetId === undefined) return redirectToCurrentChangeSet(request, reply);
    const changeSetId = Number(request.query.changeSetId);
    const changeSet = await getChangeSet(changeSetId);
    const headers = getResponseHeaders(changeSet);
    const parks = await getParks(changeSet);

    reply.headers(headers).send(parks);
  });

  fastify.get('/code/:code', { schema: getParkSchema, projection }, async (request, reply) => {
    if (request.query.changeSetId === undefined) return redirectToCurrentChangeSet(request, reply);
    const code = String(request.params.code).toUpperCase();
    const changeSetId = Number(request.query.changeSetId);
    const changeSet = await getChangeSet(changeSetId);
    const headers = getResponseHeaders(changeSet);
    const park = await getPark(changeSet, code);

    if (!park) throw createError(404, `Park not found: ${code}`);
    reply.headers(headers).send(park);
  });

  async function redirectToCurrentChangeSet(request, reply) {
    const { path } = uri.parse(request.url);
    const changeSet = await filby.getCurrentChangeSet(projection);
    if (!changeSet) throw createError(404, `No current change set for projection: ${projection.name} ${projection.version}`);
    reply.redirect(307, `${path}?changeSetId=${changeSet.id}`);
  }

  async function getChangeSet(changeSetId) {
    const changeSet = await filby.getChangeSet(changeSetId);
    if (!changeSet) throw createError(400, `Invalid changeSetId: ${changeSetId}`);
    return changeSet;
  }

  async function getParks(changeSet) {
    const { documents } = await filby.getDocuments(projection, changeSet.id);
    return documents;
  }

  async function getPark(changeSet, code) {
    const { documents } = await filby.getDocuments(projection, changeSet.id, { parameters: { code } });
    return documents[0];
  }

  function getResponseHeaders(changeSet) {
    return {
      'Last-Modified': changeSet.lastModified.toUTCString(),
      'ETag': changeSet.entityTag,
      'Cache-Control': 'max-age=31536000, immutable',
      'Connection': 'close',
    };
  }

  done();
};
