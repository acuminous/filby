import { FastifyInstance } from 'fastify';
import { Filby } from '../../../..';

export default (fastify: FastifyInstance, { filby }: { filby: Filby }, done: (err?: Error) => void) => {

	fastify.get('/', async (_request, reply) => {
		const status = await filby.getNotificationStatus();
		reply.code(status.started && status.failuresSinceLastSuccess === 0 ? 200 : 503);
		return status;
	});

	done();
}
