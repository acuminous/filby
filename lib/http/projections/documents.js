import { projectionArguments } from '../../helpers.js';
import { MissingFunctionError } from '../../errors.js';
import { HttpError, PROJECTION_PATH, findProjection, decode, getInteger, json } from '../handler.js';
import { toChangeSet } from '../../mappers.js';

const POSITIVE_INTEGER = /^[1-9]\d*$/;
const RESERVED = ['changeSetId', 'page', 'pageSize'];

const routes = [
  [PROJECTION_PATH, getProjection],
];

async function getProjection(filby, [, encoded, version], url, loadDocuments) {
  const name = decode(encoded, 'projection');
  return filby.withTransaction(async (tx) => {
    const projection = await findProjection(tx, name, Number(version));
    if (!url.searchParams.has('changeSetId')) return redirectToCurrentChangeSet(tx, url, projection);
    const changeSet = await findChangeSet(tx, getInteger(url, 'changeSetId'));
    const declaration = await getDeclaration(tx, projection);
    const parameters = getParameters(url, projection, declaration);
    const { page, size } = getPaging(url, declaration);
    const load = (pageOffset, pageSize) => loadDocuments(tx, projection, changeSet.id, { parameters, pageOffset, pageSize }).catch((err) => {
      throw err instanceof MissingFunctionError ? new HttpError(500, err.message) : err;
    });
    const { documents, total } = await loadPage(load, page, size);
    return json(200, documents, {
      ETag: `"${changeSet.entityTag}"`,
      'Last-Modified': changeSet.lastModified.toUTCString(),
      'Cache-Control': 'max-age=31536000, immutable',
      'X-Total-Count': String(total),
      ...links(url, page, size, documents.length, total),
    });
  });
}

async function redirectToCurrentChangeSet(tx, url, projection) {
  const { rows } = await tx.query(`
    SELECT change_set_id, effective, description, last_modified, entity_tag, reissued_from
    FROM fby_projection_change_log_vw
    WHERE projection_id = $1 AND effective <= now()
    ORDER BY effective DESC, change_set_id DESC
    LIMIT 1`, [projection.id]);
  const [changeSet] = rows.map(toChangeSet);
  if (!changeSet) throw new HttpError(404, `Projection '${projection.key}' has no current change set`);
  const target = new URL(url);
  target.searchParams.set('changeSetId', changeSet.id);
  return new Response(null, { status: 307, headers: { Location: `${target.pathname}${target.search}` } });
}

async function findChangeSet(tx, changeSetId) {
  const { rows } = await tx.query('SELECT id AS change_set_id, effective, description, last_modified, entity_tag, reissued_from FROM fby_change_set WHERE id = $1', [changeSetId]);
  if (!rows.length) throw new HttpError(400, `Change set ${changeSetId} does not exist`);
  return toChangeSet(rows[0]);
}

async function getDeclaration(tx, projection) {
  const { rows: [declaration] } = await tx.query('SELECT root_entity_id, page_size, page_max FROM fby_projection WHERE id = $1', [projection.id]);
  const { rows: parameters } = await tx.query('SELECT name, match FROM fby_projection_parameter WHERE projection_id = $1 ORDER BY position', [projection.id]);
  return { ...declaration, parameters };
}

function getParameters(url, projection, declaration) {
  const declared = declaration.parameters.flatMap(projectionArguments).map(({ name, array }) => ({ name: name.slice(2), array }));
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

function getPaging(url, declaration) {
  const page = getPositiveInteger(url, 'page') ?? 1;
  const pageSize = getPositiveInteger(url, 'pageSize');
  const size = declaration.page_size ? Math.min(pageSize ?? declaration.page_size, declaration.page_max) : pageSize;
  return { page, size };
}

async function loadPage(load, page, size) {
  if (size !== undefined) return load((page - 1) * size, size);
  if (page === 1) return load(0, undefined);
  const { total } = await load(0, 1);
  return { documents: [], total };
}

function links(url, page, size, count, total) {
  const entries = [];
  if (page > 1) entries.push(link(url, page - 1, 'prev'));
  if (size !== undefined && (page - 1) * size + count < total) entries.push(link(url, page + 1, 'next'));
  return entries.length ? { Link: entries.join(', ') } : {};
}

function link(url, page, rel) {
  const target = new URL(url);
  target.searchParams.set('page', page);
  return `<${target.pathname}${target.search}>; rel="${rel}"`;
}

function getPositiveInteger(url, name) {
  const value = url.searchParams.get(name);
  if (value === null) return undefined;
  if (!POSITIVE_INTEGER.test(value)) throw new HttpError(400, `Query parameter '${name}' must be a positive integer`);
  return Number(value);
}

export { routes };
