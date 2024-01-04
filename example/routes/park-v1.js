const createError = require('http-errors');
const schemas = require('./park-v1-schemas');

module.exports = (fastify, { rdf }, done) => {

  fastify.get('/', { schema: schemas.getParks }, async (request, reply) => {
    const changeSet = await getChangeSet(request);
    const parks = await getParks(changeSet);

    reply.headers({
      'Last-Modified': changeSet.lastModified,
      'ETag': changeSet.eTag,
      'Cache-Control': 'max-age=31536000, immutable',
    });

    return parks;
  });

  fastify.get('/:code', { schema: schemas.getPark }, async (request, reply) => {
    const changeSet = await getChangeSet(request);
    const code = request.params.code;
    const park = await getPark(changeSet, code);
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
    const changeSet = await rdf.getChangeSet(changeSetId);
    if (!changeSet) throw createError(400, `Invalid changeSetId`)
    return changeSet;
  }

  async function getParks(changeSet) {
    return rdf.withTransaction(async (tx) => {
      const { rows } = await tx.query('SELECT code, name, calendar_event, calendar_occurs FROM get_park_v1($1)', [changeSet.changeSetId]);
      const parkDictionary = rows.reduce(toParkDictionary, new Map());
      return Array.from(parkDictionary.values());
    });
  }

  async function getPark(changeSet, code) {
    return withTransaction(async (tx) => {
      const { rows } = await tx.query('SELECT code, name, calendar_event, calendar_occurs FROM get_park_v1($1) WHERE code = upper($2)', [changeSet.changeSetId, code]);
      const parkDictionary = rows.reduce(toParkDictionary, new Map());
      return parkDictionary.get(code);
    });
  };

  function toParkDictionary(dictionary, row) {
    const { code, name, calendar_event, calendar_occurs } = row;
    const park = dictionary.get(code) || { code, name, calendar: [] };
    park.calendar.push({ event: calendar_event, occurs: calendar_occurs });
    return dictionary.set(code, park);
  }

  done();
}

