import { FastifyInstance, FastifyRequest } from 'fastify';
import createError from 'http-errors';
import Filby, { RdfChangeSet } from '../../..';

export default (fastify: FastifyInstance, { filby }: { filby: Filby }, done: (err?: Error) => void) => {

  const getParksSchema = {
    querystring: {
      type: "object",
      required: ["changeSetId"],
      properties: {
        changeSetId: {
          type: "integer"
        }
      }
    }
  } as const;

  fastify.get<{
    Querystring: typeof getParksSchema.querystring.properties,
  }>('/', { schema: getParksSchema }, async (request, reply) => {
    const changeSet = await getChangeSet(request);
    const parks = await getParks(changeSet);

    reply.headers({
      'Last-Modified': changeSet.lastModified.toUTCString(),
      'ETag': changeSet.entityTag,
      'Cache-Control': 'max-age=31536000, immutable',
    });

    return parks;
  });

  const getParkSchema = {
    querystring: {
      type: "object",
      required: ["changeSetId"],
      properties: {
        changeSetId: {
          type: "integer"
        }
      }
    },
    params: {
      type: "object",
      required: ["code"],
      properties: {
        code: {
          type: "string"
        }
      }
    }
  } as const;

  fastify.get<{
    Querystring: typeof getParkSchema.querystring.properties,
    Params: typeof getParkSchema.params.properties
  }>('/:code', { schema: getParkSchema }, async (request, reply) => {
    const changeSet = await getChangeSet(request);
    const code = String(request.params.code);
    const park = await getPark(changeSet, code);
    if (!park) throw createError(404, `Park not found: ${code}`);

    reply.headers({
      'Last-Modified': changeSet.lastModified.toUTCString(),
      'ETag': changeSet.entityTag,
      'Cache-Control': 'max-age=31536000, immutable',
    });

    return park;
  });

  async function getChangeSet(request: FastifyRequest<{ Querystring: typeof getParksSchema.querystring.properties }> | FastifyRequest<{ Querystring: typeof getParkSchema.querystring.properties }>) {
    const changeSetId = Number(request.query.changeSetId);
    const changeSet = await filby.getChangeSet(changeSetId);
    if (!changeSet) throw createError(400, `Invalid changeSetId`)
    return changeSet;
  }

  async function getParks(changeSet: RdfChangeSet) {
    return filby.withTransaction(async (tx) => {
      const { rows } = await tx.query('SELECT code, name, calendar_event, calendar_occurs FROM get_park_v1($1)', [changeSet.id]);
      const parkDictionary = rows.reduce(toParkDictionary, new Map());
      return Array.from(parkDictionary.values());
    });
  }

  async function getPark(changeSet: RdfChangeSet, code: string) {
    return filby.withTransaction(async (tx) => {
      const { rows } = await tx.query('SELECT code, name, calendar_event, calendar_occurs FROM get_park_v1($1) WHERE code = upper($2)', [changeSet.id, code]);
      const parkDictionary = rows.reduce(toParkDictionary, new Map());
      return parkDictionary.get(code);
    });
  };

  function toParkDictionary(dictionary: Map<string, any>, row: any) {
    const { code, name, calendar_event, calendar_occurs } = row;
    const park = dictionary.get(code) || { code, name, calendar: [] };
    park.calendar.push({ event: calendar_event, occurs: calendar_occurs });
    return dictionary.set(code, park);
  }

  done();
}
