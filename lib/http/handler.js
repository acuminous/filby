import { toProjection } from '../mappers.js';

const METHODS = ['GET', 'HEAD'];
const PROJECTION_PATH = /^\/projections\/([^/]+)\/v(\d+)$/;

class HttpError extends Error {
  constructor(status, message, headers) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

async function handle(request, basePath, resolve) {
  const response = await respond(request, basePath.replace(/\/+$/, ''), resolve);
  return request.method === 'HEAD' ? new Response(null, { status: response.status, headers: response.headers }) : response;
}

async function respond(request, basePath, resolve) {
  const url = new URL(request.url);
  try {
    const route = url.pathname.startsWith(basePath) ? resolve(url.pathname.slice(basePath.length), basePath) : undefined;
    if (!route) throw new HttpError(404, `No route for ${url.pathname}`);
    if (!METHODS.includes(request.method)) throw new HttpError(405, `Method ${request.method} is not allowed`, { Allow: METHODS.join(', ') });
    return await route(url);
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.message }, err.headers);
    if (typeof err.code === 'string' && err.code.startsWith('22')) return json(400, { error: err.message });
    throw err;
  }
}

function decode(name, kind) {
  try {
    return decodeURIComponent(name);
  } catch {
    throw new HttpError(400, `Malformed ${kind} name '${name}'`);
  }
}

async function findProjection(tx, name, version) {
  const { rows } = await tx.query('SELECT id, name, version FROM fby_projection WHERE name = $1 AND version = $2 AND dropped_at IS NULL FOR SHARE', [name, version]);
  if (rows.length) return toProjection(rows[0]);
  const { rowCount: dropped } = await tx.query('SELECT 1 FROM fby_projection WHERE name = $1 AND version = $2 AND dropped_at IS NOT NULL', [name, version]);
  if (dropped) throw new HttpError(410, `Projection '${name} v${version}' was dropped`);
  throw new HttpError(404, `Projection '${name} v${version}' does not exist`);
}

function json(status, body, headers) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

export { HttpError, PROJECTION_PATH, handle, decode, findProjection, json };
