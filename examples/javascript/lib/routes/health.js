module.exports = (fastify, { filby }, done) => {

  fastify.get('/', async (_request, reply) => {
    const status = await filby.getNotificationStatus();
    reply.code(status.started && status.failuresSinceLastSuccess === 0 ? 200 : 503);
    return status;
  });

  done();
};
