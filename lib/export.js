import openapi from './openapi.js';
import pkg from '../package.json' with { type: 'json' };

const { version: filbyVersion } = pkg;

const FORMAT = 1;

export default async function exportBundle(filby, name, version) {
  const projection = await filby.getProjection(name, version);
  if (!projection) throw new Error(`Projection '${name} v${version}' does not exist`);

  const { description, root } = await getDeclaration(filby, projection);
  const path = `/projections/${encodeURIComponent(projection.name)}/v${projection.version}`;
  const schema = await getSchema(filby, path);
  const changeSets = await filby.getChangeLog(projection);
  const documents = {};
  for (const changeSet of changeSets) {
    documents[changeSet.id] = root ? await getAllDocuments(filby, projection, changeSet.id) : await getRows(filby, path, changeSet.id);
  }

  return JSON.parse(JSON.stringify({ format: FORMAT, filby: filbyVersion, name: projection.name, version: projection.version, description, schema, changeSets, documents }));
}

async function getDeclaration(filby, projection) {
  const { rows: [{ description, root_entity_id: root }] } = await filby.withTransaction((tx) => tx.query('SELECT description, root_entity_id FROM fby_projection WHERE id = $1', [projection.id]));
  return { description, root };
}

async function getSchema(filby, path) {
  const document = await openapi(filby);
  return document.paths[path].get.responses[200].content['application/json'].schema.items;
}

async function getAllDocuments(filby, projection, changeSetId) {
  const all = [];
  let total;
  do {
    const { documents, total: matched } = await filby.getDocuments(projection, changeSetId, { pageOffset: all.length });
    all.push(...documents);
    total = documents.length ? matched : all.length;
  } while (all.length < total);
  return all;
}

async function getRows(filby, path, changeSetId) {
  const all = [];
  let total;
  for (let page = 1; total === undefined || all.length < total; page++) {
    const response = await filby.fetchProjections(new Request(`http://localhost${path}?changeSetId=${changeSetId}&page=${page}`));
    const body = await response.json();
    if (!response.ok) throw new Error(body.error);
    all.push(...body);
    total = body.length ? Number(response.headers.get('X-Total-Count')) : all.length;
  }
  return all;
}
