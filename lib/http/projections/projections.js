import { json } from '../handler.js';

const routes = [
  [/^\/projections$/, getProjections],
];

async function getProjections(filby) {
  const { rows } = await filby.withTransaction((tx) => tx.query('SELECT name, version, description FROM fby_projection WHERE dropped_at IS NULL ORDER BY name, version'));
  return json(200, rows);
}

export { routes };
