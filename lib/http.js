const { escapeIdentifier } = require('pg');

const { projectionFunction, projectionArguments } = require('./helpers');
const openapi = require('./openapi');

const INTEGER = /^\d+$/;
const POSITIVE_INTEGER = /^[1-9]\d*$/;
const PROJECTION_PATH = /^\/projections\/([^/]+)\/v(\d+)$/;
const RESERVED = ['changeSetId', 'page', 'pageSize'];

class HttpError extends Error {
  constructor(status, message, headers) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

module.exports = async function fetch(filby, request, { basePath = '', info } = {}) {
  const url = new URL(request.url);
  try {
    const route = getRoute(url, basePath, info);
    if (request.method !== 'GET') throw new HttpError(405, `Method ${request.method} is not allowed`, { Allow: 'GET' });
    return await route(filby, url);
  } catch (err) {
    if (err instanceof HttpError) return json(err.status, { error: err.message }, err.headers);
    if (typeof err.code === 'string' && err.code.startsWith('22')) return json(400, { error: err.message });
    throw err;
  }
};

function getRoute(url, basePath, info) {
  if (!url.pathname.startsWith(basePath)) throw new HttpError(404, `No route for ${url.pathname}`);
  const pathname = url.pathname.slice(basePath.length);
  if (pathname === '/changelog') return getChangeLog;
  if (pathname === '/openapi.json') return (filby) => getOpenApi(filby, basePath, info);
  const projection = pathname.match(PROJECTION_PATH);
  if (projection) return (filby, url) => getProjection(filby, url, decode(projection[1]), Number(projection[2]));
  throw new HttpError(404, `No route for ${url.pathname}`);
}

function decode(name) {
  try {
    return decodeURIComponent(name);
  } catch {
    throw new HttpError(400, `Malformed projection name '${name}'`);
  }
}

async function getOpenApi(filby, basePath, info) {
  return json(200, await openapi(filby, { basePath, info }));
}

async function getChangeLog(filby, url) {
  const name = url.searchParams.get('projection');
  if (name === null) throw new HttpError(400, "Missing query parameter 'projection'");
  const version = getInteger(url, 'version');
  const since = url.searchParams.has('since') ? getInteger(url, 'since') : undefined;
  const projection = await findProjection(filby, name, version);
  const changeLog = await filby.getChangeLog(projection, { since });
  const latest = changeLog[changeLog.length - 1];
  return json(200, changeLog, latest && { ETag: latest.entityTag, 'Last-Modified': latest.lastModified.toUTCString() });
}

async function getProjection(filby, url, name, version) {
  const projection = await findProjection(filby, name, version);
  if (!url.searchParams.has('changeSetId')) return redirectToCurrentChangeSet(filby, url, projection);
  const changeSet = await findChangeSet(filby, getInteger(url, 'changeSetId'));
  const declaration = await getDeclaration(filby, projection);
  const parameters = getParameters(url, projection, declaration);
  const { documents, total, page, size } = declaration.root_entity_id
    ? await getDocuments(filby, url, projection, declaration, changeSet, parameters)
    : await getRows(filby, url, projection, changeSet);
  return json(200, documents, {
    ETag: changeSet.entityTag,
    'Last-Modified': changeSet.lastModified.toUTCString(),
    'Cache-Control': 'max-age=31536000, immutable',
    'X-Total-Count': String(total),
    ...links(url, page, size, documents.length, total),
  });
}

async function redirectToCurrentChangeSet(filby, url, projection) {
  const changeSet = await filby.getCurrentChangeSet(projection);
  if (!changeSet) throw new HttpError(404, `Projection '${projection.key}' has no current change set`);
  const target = new URL(url);
  target.searchParams.set('changeSetId', changeSet.id);
  return new Response(null, { status: 307, headers: { Location: `${target.pathname}${target.search}` } });
}

async function findProjection(filby, name, version) {
  const projection = await filby.getProjection(name, version);
  if (!projection) throw new HttpError(404, `Projection '${name} v${version}' does not exist`);
  return projection;
}

async function findChangeSet(filby, changeSetId) {
  const changeSet = await filby.getChangeSet(changeSetId);
  if (!changeSet) throw new HttpError(400, `Change set ${changeSetId} does not exist`);
  return changeSet;
}

async function getDeclaration(filby, projection) {
  return filby.withTransaction(async (tx) => {
    const { rows: [declaration] } = await tx.query('SELECT root_entity_id, page_size, page_max FROM fby_projection WHERE id = $1', [projection.id]);
    const { rows: parameters } = await tx.query('SELECT name, match FROM fby_projection_parameter WHERE projection_id = $1 ORDER BY position', [projection.id]);
    return { ...declaration, parameters };
  });
}

function getParameters(url, projection, declaration) {
  const declared = declaration.parameters.flatMap(projectionArguments).map(({ name, array }) => ({ name: name.slice(2), array })).filter(({ name }) => !RESERVED.includes(name));
  for (const key of new Set(url.searchParams.keys())) {
    if (RESERVED.includes(key)) continue;
    if (!declared.some(({ name }) => name === key)) throw new HttpError(400, `Projection '${projection.key}' has no parameter '${key}'${parameterHint(declared)}`);
  }
  return Object.fromEntries(declared.filter(({ name }) => url.searchParams.has(name)).map(({ name, array }) => {
    const values = url.searchParams.getAll(name);
    if (!array && values.length > 1) throw new HttpError(400, `Query parameter '${name}' must not be repeated`);
    return [name, array ? values : values[0]];
  }));
}

function parameterHint(declared) {
  return declared.length ? `; existing parameters are ${declared.map(({ name }) => `'${name}'`).join(', ')}` : '; it has no parameters';
}

async function getDocuments(filby, url, projection, declaration, changeSet, parameters) {
  const page = getPositiveInteger(url, 'page');
  const pageSize = getPositiveInteger(url, 'pageSize');
  if (!declaration.page_size) {
    if (page || pageSize) throw new HttpError(400, `Projection '${projection.key}' has no paging`);
    return filby.getDocuments(projection, changeSet.id, { parameters });
  }
  const size = Math.min(pageSize ?? declaration.page_size, declaration.page_max);
  const pageOffset = ((page ?? 1) - 1) * size;
  const { documents, total } = await filby.getDocuments(projection, changeSet.id, { parameters, pageOffset, pageSize: size });
  return { documents, total, page: page ?? 1, size };
}

async function getRows(filby, url, projection, changeSet) {
  const page = getPositiveInteger(url, 'page');
  const size = getPositiveInteger(url, 'pageSize');
  if (page && !size) throw new HttpError(400, "Query parameter 'page' requires 'pageSize'");
  const functionName = projectionFunction(projection.name, projection.version);
  return filby.withTransaction(async (tx) => {
    const { rowCount: functionExists } = await tx.query('SELECT 1 FROM pg_proc WHERE proname = $1', [functionName]);
    if (!functionExists) throw new HttpError(500, `Function '${functionName}' does not exist`);
    if (!size) {
      const { rows } = await tx.query(`SELECT * FROM ${escapeIdentifier(functionName)}($1)`, [changeSet.id]);
      return { documents: rows, total: rows.length };
    }
    const { rows } = await tx.query(`SELECT *, COUNT(*) OVER () AS fby_total FROM ${escapeIdentifier(functionName)}($1) LIMIT $2 OFFSET $3`, [changeSet.id, size, ((page ?? 1) - 1) * size]);
    const documents = rows.map(({ fby_total, ...document }) => document);
    return { documents, total: Number(rows[0]?.fby_total ?? 0), page: page ?? 1, size };
  });
}

function links(url, page, size, count, total) {
  if (!size) return {};
  const entries = [];
  if (page > 1) entries.push(link(url, page - 1, 'prev'));
  if ((page - 1) * size + count < total) entries.push(link(url, page + 1, 'next'));
  return entries.length ? { Link: entries.join(', ') } : {};
}

function link(url, page, rel) {
  const target = new URL(url);
  target.searchParams.set('page', page);
  return `<${target.pathname}${target.search}>; rel="${rel}"`;
}

function getInteger(url, name) {
  const value = url.searchParams.get(name);
  if (value === null) throw new HttpError(400, `Missing query parameter '${name}'`);
  if (!INTEGER.test(value)) throw new HttpError(400, `Query parameter '${name}' must be an integer`);
  return Number(value);
}

function getPositiveInteger(url, name) {
  const value = url.searchParams.get(name);
  if (value === null) return undefined;
  if (!POSITIVE_INTEGER.test(value)) throw new HttpError(400, `Query parameter '${name}' must be a positive integer`);
  return Number(value);
}

function json(status, body, headers) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
