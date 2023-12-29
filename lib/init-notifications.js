const { promiseApi: pipsqueak } = require('pipsqueak');

async function initNotifications(config, db) {

	const { default: ky } = await import('ky');

	const factory = async (ctx) => {
		let ok = true;
		do {
			ok = await db.withTransaction(async (tx) => {
				const notification = await getNextNotification(tx, config.maxAttempts);
				if (!notification) return false;

				try {
					const webhook = await getWebhook(tx, notification);
					const response = await ky.post(webhook.url, { json: webhook.projection });
					await passNotification(tx, notification, response);
				} catch (err) {
					await failNotification(tx, notification, err);
				}
				return true;
			});
		} while (ok);
	}

	async function getNextNotification(tx, maxAttempts) {
		const { rows } = await tx.query('SELECT id, webhook_id, attempts FROM rdf_get_next_notification($1)', [maxAttempts]);
		const notifications = rows.map((row) => ({ id: row.id, webhookId: row.webhook_id, attempts: row.attempts}));
		return notifications[0];
	}

	async function getWebhook(tx, notification) {
		const { rows } = await tx.query('SELECT w.url, p.name, p.version FROM rdf_webhook w INNER JOIN rdf_projection p ON p.id = w.projection_id WHERE w.id = $1', [notification.webhookId]);
		const webhooks = rows.map((row) => ({ url: row.url, projection: { name: row.name, version: row.version }}))
		return webhooks[0];
	}

	async function passNotification(tx, notification, response) {
		await tx.query('SELECT rdf_pass_notification($1, $2)', [notification.id, response.status])
	}

	async function failNotification(tx, notification, err) {
		const scheduledFor = new Date(Date.now() + Math.pow(2, notification.attempts) * 1000);
		await tx.query('SELECT rdf_fail_notification($1, $2, $3, $4)', [notification.id, scheduledFor, err?.response?.status, err.message])
	}

	return pipsqueak({ name: 'rdf', factory, interval: config.interval, delay: config.delay, disabled: config.disabled  });
}


module.exports = initNotifications;
