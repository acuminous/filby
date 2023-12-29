const config = require('./config');
const initDatabase = require('./lib/init-database');
const initServer = require('./lib/init-server');
const initNotifications = require('./lib/init-notifications');

(async () => {
	const db = await initDatabase(config.database);
	await db.runMigrations();

	const notifications = await initNotifications(config.notifications, db);
	const server = await initServer(db, notifications);

	try {
	  await server.listen(config.server);
	  notifications.start();
		registerShutdownHooks(server);
	  console.log(`Server is listening on port ${config.server.port}`);
	  console.log(`See http://localhost:${config.server.port}/documentation`);
	  console.log(`Use CTRL+D or kill -TERM ${process.pid} to stop`);
	} catch (err) {
		console.error(err);
	  process.exit(1)
	}
})();

function registerShutdownHooks(server) {
  process.once('SIGINT', () => process.emit('rdf_stop'));
  process.once('SIGTERM', () => process.emit('rdf_stop'));
  process.once('rdf_stop', async () => {
  	process.removeAllListeners('rdf_stop');
		await server.close();
		console.log('Server has stopped');
  })
}
