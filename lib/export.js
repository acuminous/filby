import openapi from './openapi.js';
import pkg from '../package.json' with { type: 'json' };

const { version: filbyVersion } = pkg;

const FORMAT = 1;

export default async function exportBundle(filby, name, version) {
  const projection = await filby.getProjection(name, version);
  if (!projection) throw new Error(`Projection '${name} v${version}' does not exist`);

  const description = await getDescription(filby, projection);
  const schema = await getSchema(filby, `/projections/${encodeURIComponent(projection.name)}/v${projection.version}`);
  const changeSets = await filby.getChangeLog(projection);
  const documents = {};
  for (const changeSet of changeSets) {
    documents[changeSet.id] = await getAllDocuments(filby, projection, changeSet.id);
  }

  return JSON.parse(JSON.stringify({ format: FORMAT, filby: filbyVersion, name: projection.name, version: projection.version, description, schema, changeSets, documents }));
}

async function getDescription(filby, projection) {
  const { rows: [{ description }] } = await filby.withTransaction((tx) => tx.query('SELECT description FROM fby_projection WHERE id = $1', [projection.id]));
  return description;
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
