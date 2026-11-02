const openapi = require('./openapi');
const { canonical } = require('./helpers');
const { version: filbyVersion } = require('../package.json');

const FORMAT = 1;

module.exports = async function exportBundle(filby, name, version) {
  const projection = await filby.getProjection(name, version);
  if (!projection) throw new Error(`Projection '${name} v${version}' does not exist`);

  const { description, root, parameters } = await getDeclaration(filby, projection);
  if (!root) throw new Error(`Projection '${projection.key}' is not declared with a root`);

  const schema = await getSchema(filby, projection);
  const hidden = parameters.find(({ field }) => !schema.properties[field]);
  if (hidden) throw new Error(`Projection '${projection.key}' parameter '${hidden.name}' filters on field '${hidden.field}', which its documents do not carry`);

  const changeSets = await filby.getChangeLog(projection);
  const documents = {};
  for (const changeSet of changeSets) documents[changeSet.id] = await getAllDocuments(filby, projection, changeSet.id);

  return JSON.parse(JSON.stringify({ format: FORMAT, filby: filbyVersion, name: projection.name, version: projection.version, description, parameters, schema, changeSets, documents }));
};

async function getDeclaration(filby, projection) {
  return filby.withTransaction(async (tx) => {
    const { rows: [{ description, root_entity_id: root }] } = await tx.query('SELECT description, root_entity_id FROM fby_projection WHERE id = $1', [projection.id]);
    const { rows: parameters } = await tx.query(`
      SELECT p.name, p.field, p.match, f.type
      FROM fby_projection_parameter p
      INNER JOIN fby_entity_field f ON f.entity_id = $2 AND f.name = p.field
      WHERE p.projection_id = $1
      ORDER BY p.position`, [projection.id, root]);
    return { description, root, parameters: parameters.map((parameter) => ({ ...parameter, name: canonical(parameter.name) })) };
  });
}

async function getSchema(filby, projection) {
  const document = await openapi(filby);
  const path = document.paths[`/projections/${encodeURIComponent(projection.name)}/v${projection.version}`];
  return path.get.responses[200].content['application/json'].schema.items;
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
