import { json } from '../handler.js';
import { sql } from '../../database/sql.js';

const routes = [
  [/^\/projections$/, getProjections],
];

async function getProjections(filby) {
  const { rows } = await filby.withTransaction((tx) => tx.query(sql.projections.listSummaries));
  return json(200, rows);
}

export { routes };
