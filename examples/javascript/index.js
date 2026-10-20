const { serve } = require('@hono/node-server');

const config = require('./config');
const Application = require('./lib/Application');

(async () => {
  const application = new Application({ config });
  await application.start();
  const server = serve({ fetch: application.app.fetch, port: config.server.port });

  process.on('SIGINT', (event) => process.emit('APPLICATION_STOP', event));
  process.on('SIGTERM', (event) => process.emit('APPLICATION_STOP', event));
  process.once('APPLICATION_STOP', async (event) => {
    process.removeAllListeners('APPLICATION_STOP');
    console.log(`Caught ${event}. Stopping...`);
    await new Promise((resolve) => server.close(resolve));
    await application.stop();
    console.log('Server has stopped');
  });

  console.log(`Server is listening on port ${config.server.port}`);
  console.log(`See http://localhost:${config.server.port}/documentation`);
  console.log(`Use CTRL+C or kill -TERM ${process.pid} to stop`);
})();
