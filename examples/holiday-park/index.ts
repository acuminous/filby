import { serve } from '@hono/node-server';

import config from './config';
import Application from './lib/Application';

type AppProcess = NodeJS.Process & {
  emit(event: string, context: any): boolean;
};

const app: AppProcess = process;

(async () => {
  const application = new Application({ config });
  await application.start();
  const server = serve({ fetch: application.app.fetch, port: config.server.port });

  app.on('SIGINT', (event) => app.emit('APPLICATION_STOP', event));
  app.on('SIGTERM', (event) => app.emit('APPLICATION_STOP', event));
  app.once('APPLICATION_STOP', async (event) => {
    app.removeAllListeners('APPLICATION_STOP');
    console.log(`Caught ${event}. Stopping...`);
    await new Promise((resolve) => server.close(resolve));
    await application.stop();
    console.log('Server has stopped');
  });

  console.log(`Server is listening on port ${config.server.port}`);
  console.log(`See http://localhost:${config.server.port}/documentation`);
  console.log(`Use CTRL+C or kill -TERM ${app.pid} to stop`);
})();
