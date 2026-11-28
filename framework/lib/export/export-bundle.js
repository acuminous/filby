import { openapi } from '../http/projections/openapi.js';
import pkg from '../../package.json' with { type: 'json' };
import { sql } from '../database/sql.js';

const { version: filbyVersion } = pkg;

const FORMAT = 1;

export async function exportBundle(filby, projection, getDocuments) {
  const description = await getDescription(filby, projection);
  const schema = await getSchema(filby, `/projections/${encodeURIComponent(projection.name)}/v${projection.version}`);
  const changeSets = await filby.getChangeLog(projection);
  const documents = {};
  for (const changeSet of changeSets) {
    documents[changeSet.id] = await getAllDocuments(getDocuments, projection, changeSet.id);
  }

  return JSON.parse(JSON.stringify({ format: FORMAT, filby: filbyVersion, name: projection.name, version: projection.version, description, schema, changeSets, documents }));
}

async function getDescription(filby, projection) {
  const { rows: [declaration] } = await filby.withTransaction((tx) => tx.query(sql.projections.getDescription, [projection.id]));
  if (!declaration) throw new Error(`Projection '${projection.key}' does not exist`);
  return declaration.description;
}

async function getSchema(filby, path) {
  const document = await openapi(filby);
  return document.paths[path].get.responses[200].content['application/json'].schema.items;
}

async function getAllDocuments(getDocuments, projection, changeSetId) {
  const all = [];
  let total;
  do {
    const { documents, total: matched } = await getDocuments(projection, changeSetId, { pageOffset: all.length });
    all.push(...documents);
    total = documents.length ? matched : all.length;
  } while (all.length < total);
  return all;
}
