const path = require('node:path');

const marv = require('marv/api/promise');
const driver = require('marv-pg-driver');
const { Pool } = require('pg');

async function initDatabase(config) {

	const pool = new Pool(config);

	async function runMigrations() {
		await migrate(config, path.resolve('migrations/nuke'));
		await migrate(config, path.resolve('migrations/rdf'));
		await migrate(config, path.resolve('migrations'));
		await migrate(config, path.resolve('migrations/testdata'));
	}

	async function migrate(connection, directory) {
		const migrations = await marv.scan(directory);
		return marv.migrate(migrations, driver({ connection }));
	}

	async function withTransaction(fn) {
		const client = await pool.connect();
		try {
			const result = await fn(client);
			return result;
		} finally {
			await client.release();
		}
	}

	async function getProjections() {
		return withTransaction(async (tx) => {
			const { rows } = await tx.query('SELECT name, version FROM rdf_projection');
			return rows;
		});
	}

	async function getChangeLog(name, version) {
		return withTransaction(async (tx) => {
			const { rows } = await tx.query('SELECT change_set_id AS id, effective_from, notes, last_modified, entity_tag FROM rdf_projection_change_log_vw WHERE projection_name = $1 AND projection_version = $2', [name, version]);
		  return rows.map(toChangeSet);
		});
	};

	async function getChangeSet(changeSetId) {
		return withTransaction(async (tx) => {
			const { rows } = await tx.query('SELECT id, last_modified, entity_tag FROM rdf_change_set WHERE id = $1', [changeSetId]);
			return rows.map(toChangeSet)[0];
		});
	}

	async function getParkDictionary(changeSet) {
		return withTransaction(async (tx) => {
			const { rows } = await tx.query('SELECT code, name, calendar_event, calendar_occurs FROM get_park_v1($1)', [changeSet.id]);
			return rows.reduce(toParkDictionary, new Map());
		});
	};

	async function getParks(changeSet) {
		const parkDictionary = await getParkDictionary(changeSet);
		return Array.from(parkDictionary.values());
	}

	async function getPark(changeSet, code) {
		return withTransaction(async (tx) => {
			const { rows } = await tx.query('SELECT code, name, calendar_event, calendar_occurs FROM get_park_v1($1) WHERE code = upper($2)', [changeSet.id, code]);
			const parkDictionary = rows.reduce(toParkDictionary, new Map());
			return parkDictionary.get(code);
		});
	};

	function toChangeSet(row) {
		return {
			id: row.id,
			effectiveFrom: row.effective_from,
			notes: row.notes,
			lastModified: row.last_modified,
			eTag: row.entity_tag
		};
	}

	function toParkDictionary(dictionary, row) {
		const { code, name, calendar_event, calendar_occurs } = row;
		const park = dictionary.get(code) || { code, name, calendar: [] };
		park.calendar.push({ event: calendar_event, occurs: calendar_occurs });
		return dictionary.set(code, park);
	}

	async function close() {
		await pool.end();
	}

	return {
		runMigrations,
		close,
		withTransaction,
		getProjections,
		getChangeLog,
		getChangeSet,
		getParks,
		getPark,
	}
}



module.exports = initDatabase;
