import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import createError from 'http-errors';
import uri from 'fast-uri';

import Filby, { Projection, ChangeSet } from '../../..';
import getParksSchema from '../../schemas/get-parks-schema.json';
import getParkSchema from '../../schemas/get-park-schema.json';

type ChangeSetId = number | 'current';

export default (fastify: FastifyInstance, { projection, filby }: { projection: Projection, filby: Filby }, done: (err?: Error) => void) => {

  fastify.get<{
    Querystring: { changeSetId: ChangeSetId }
  }>('/', { schema: getParksSchema }, async (request, reply) => {
    if (request.query.changeSetId === 'current') return redirectToCurrentChangeSet(request, reply);
    const changeSetId = Number(request.query.changeSetId)
    const changeSet = await getChangeSet(changeSetId);
    const parks = await getParks(changeSet);

    reply.headers({
      'Last-Modified': changeSet.lastModified.toUTCString(),
      'ETag': changeSet.entityTag,
      'Cache-Control': 'max-age=31536000, immutable',
    });

    return parks;
  });

  fastify.get<{
    Querystring: { changeSetId: ChangeSetId },
    Params: { code: string }
  }>('/code/:code', { schema: getParkSchema }, async (request, reply) => {
    if (request.query.changeSetId === 'current') return redirectToCurrentChangeSet(request, reply);
    const code = request.params.code.toUpperCase();
    const changeSetId = Number(request.query.changeSetId)
    const changeSet = await getChangeSet(changeSetId);
    const park = await getPark(changeSet, code);
    if (!park) throw createError(404, `Park not found: ${code}`);

    reply.headers({
      'Last-Modified': changeSet.lastModified.toUTCString(),
      'ETag': changeSet.entityTag,
      'Cache-Control': 'max-age=31536000, immutable',
    });

    return park;
  });

  async function redirectToCurrentChangeSet(request: FastifyRequest, reply: FastifyReply) {
    const { path } = uri.parse(request.url);
    const changeSet = await filby.getCurrentChangeSet(projection);
    if (!changeSet) throw createError(404, `No current change set for projection: ${projection.name} ${projection.version}`);
    reply.redirect(307, `${path}?changeSetId=${changeSet.id}`);
  }

  async function getChangeSet(changeSetId: number) {
    const changeSet = await filby.getChangeSet(changeSetId);
    if (!changeSet) throw createError(400, `Invalid changeSetId: ${changeSetId}`)
    return changeSet;
  }

  async function getParks(changeSet: ChangeSet) {
    return filby.withTransaction(async (tx) => {
      const { rows } = await tx.query('SELECT code, name, calendar_event, calendar_occurs FROM get_park_v1($1)', [changeSet.id]);
      const parkDictionary = rows.reduce(toParkDictionary, new Map());
      return Array.from(parkDictionary.values());
    });
  }

  async function getPark(changeSet: ChangeSet, code: string) {
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
