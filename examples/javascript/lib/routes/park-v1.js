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
    return filby.withTransaction(async (tx) => {
      const { rows } = await tx.query('SELECT code, name, season_type, season_start, season_end FROM get_park_v1($1)', [changeSet.id]);
      const parkDictionary = rows.reduce(toParkDictionary, new Map());
      return Array.from(parkDictionary.values());
    });
  }

  async function getPark(changeSet, code) {
    return filby.withTransaction(async (tx) => {
      const { rows } = await tx.query('SELECT code, name, season_type, season_start, season_end FROM get_park_v1($1) WHERE code = upper($2)', [changeSet.id, code]);
      const parkDictionary = rows.reduce(toParkDictionary, new Map());
      return parkDictionary.get(code);
    });
  }

  function toParkDictionary(dictionary, row) {
    const { code, name, season_type: type, season_start: start, season_end: end } = row;
    const park = dictionary.get(code) || { code, name, seasons: [] };
    park.seasons.push({ type, start, end });
    return dictionary.set(code, park);
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
