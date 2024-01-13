import { FastifyInstance, FastifyRequest } from 'fastify';
import createError from 'http-errors';
import Filby from '../../../..';

const getChangelogSchema = {
	querystring: {
		type: "object",
		required: ["projection", "version"],
		properties: {
			projection: {
				type: "string"
			},
			version: {
				type: "integer"
			}
		}
	}
} as const;

export default (fastify: FastifyInstance, { filby }: { filby: Filby }, done: (err?: Error) => void) => {

	fastify.get<{
		Querystring: typeof getChangelogSchema.querystring.properties
	}>('/', { schema: getChangelogSchema }, async (request, reply) => {

		const projection = await getProjection(request)

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

	async function getProjection(request: FastifyRequest<{ Querystring: typeof getChangelogSchema.querystring.properties }>) {
		const name = String(request.query.projection);
		const version = Number(request.query.version);
		const projection = await filby.getProjection(name, version);
		if (!projection) throw createError(404, `Projection not found: ${name}-v${version}`);
		return projection;
	}

	done();
}
