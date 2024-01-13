/* eslint-disable no-console */
const config = require('./config.json');
const Application = require('./lib/Application');

(async () => {
  const application = new Application({ config });
  await application.start();

  process.on('SIGINT', (event) => process.emit('APPLICATION_STOP', event));
  process.on('SIGTERM', (event) => process.emit('APPLICATION_STOP', event));
  process.once('APPLICATION_STOP', async (event) => {
    process.removeAllListeners('APPLICATION_STOP');
    console.log(`Caught ${event}. Stopping...`);
    await application.stop();
    console.log('Server has stopped');
  });

  console.log(`Server is listening on port ${config.server?.port}`);
  console.log(`See http://localhost:${config.server?.port}/${config.swagger.prefix}`);
  console.log(`Use CTRL+D or kill -TERM ${process.pid} to stop`);
})();
