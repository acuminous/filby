import { canonicalise } from '../../naming.js';
import { PROJECTION_PATH, decode, findProjection } from '../handler.js';
import { loadProjections, documentPath } from '../../documents/projection-tree.js';
import { STRING, INTEGER, CACHE_CONTROL_HEADERS, object, response, errorResponse } from '../openapi.js';

const ENTITY_REFERENCE = { $ref: '#/components/schemas/EntityReference' };
const SINCE = { type: ['integer', 'null'] };

const routes = [
  [/^\/projections$/, listProjections],
  [PROJECTION_PATH, getProjection],
];

const paths = {
  '/projections': {
    get: {
      operationId: 'listProjectionDeclarations',
      summary: 'Projections',
      description: 'The projections that have not been dropped, ordered by name then version',
      responses: {
        200: response('The projections', { type: 'array', items: { $ref: '#/components/schemas/ProjectionSummary' } }, CACHE_CONTROL_HEADERS),
      },
    },
  },
  '/projections/{name}/v{version}': {
    get: {
      operationId: 'getProjectionDeclaration',
      summary: 'Projection declaration',
      description: 'How the migrations declared the projection',
      parameters: [
        { name: 'name', in: 'path', required: true, description: 'The projection name, URL-encoded', schema: STRING },
        { name: 'version', in: 'path', required: true, schema: INTEGER },
      ],
      responses: {
        200: response('The projection declaration', { $ref: '#/components/schemas/ProjectionDeclaration' }, CACHE_CONTROL_HEADERS),
        400: errorResponse('A projection name that cannot be URL-decoded, or a version that is too large'),
        404: errorResponse('The projection does not exist'),
        410: errorResponse('The projection was dropped'),
      },
    },
  },
};

const FIELDS = { anyOf: [{ type: 'array', items: { $ref: '#/components/schemas/ProjectionField' } }, { type: 'null' }] };
const ORDER = { type: 'array', items: { $ref: '#/components/schemas/ProjectionOrder' } };

const schemas = {
  ProjectionSummary: object({
    name: STRING,
    version: INTEGER,
    description: { type: ['string', 'null'] },
    root: { anyOf: [ENTITY_REFERENCE, { type: 'null' }] },
  }),
  ProjectionDeclaration: object({
    name: STRING,
    version: INTEGER,
    description: { type: ['string', 'null'] },
    root: { anyOf: [ENTITY_REFERENCE, { type: 'null' }] },
    dependencies: { type: 'array', items: ENTITY_REFERENCE },
    fields: FIELDS,
    order: ORDER,
    parameters: { type: 'array', items: { $ref: '#/components/schemas/ProjectionParameter' } },
    paging: { anyOf: [object({ pageSize: INTEGER, pageMax: INTEGER }), { type: 'null' }] },
    nests: { type: 'array', items: { $ref: '#/components/schemas/ProjectionNest' } },
  }),
  ProjectionField: object({ field: STRING, as: STRING, since: SINCE }),
  ProjectionOrder: object({
    field: STRING,
    direction: { enum: ['ASC', 'DESC'] },
    nulls: { enum: ['FIRST', 'LAST', null] },
  }),
  ProjectionParameter: object({
    name: STRING,
    field: STRING,
    match: { enum: ['equals', 'prefix', 'in', 'contains', 'range', 'gt', 'gte', 'lt', 'lte'] },
    property: { anyOf: [{ type: 'array', items: STRING }, { type: 'null' }] },
    since: SINCE,
  }),
  ProjectionNest: object({
    name: STRING,
    lookup: { type: 'boolean' },
    entity: ENTITY_REFERENCE,
    on: { type: 'array', items: object({ field: STRING, parentField: STRING }) },
    fields: FIELDS,
    order: ORDER,
    nests: { type: 'array', items: { $ref: '#/components/schemas/ProjectionNest' } },
    since: SINCE,
  }),
};

async function listProjections(filby) {
  const { rows } = await filby.withTransaction((tx) => tx.query(`
    SELECT p.name, p.version, p.description, e.name AS root_name, e.version AS root_version
    FROM fby_projection p
    LEFT JOIN fby_entity e ON e.id = p.root_entity_id
    WHERE p.dropped_at IS NULL
    ORDER BY p.name, p.version`));
  return rows.map(({ name, version, description, root_name, root_version }) => ({ name, version, description, root: reference(root_name, root_version) }));
}

async function getProjection(filby, [, name, version]) {
  return filby.withTransaction(async (tx) => {
    const { id } = await findProjection(tx, decode(name, 'projection'), Number(version));
    const [projection] = await loadProjections(tx, id);
    return toDeclaration(projection);
  });
}

function toDeclaration(projection) {
  return {
    name: projection.name,
    version: projection.version,
    description: projection.description,
    root: reference(projection.root_name, projection.root_version),
    dependencies: projection.dependencies.map(({ name, version }) => ({ name, version })),
    fields: toFields(projection),
    order: toOrder(projection.order),
    parameters: projection.parameters.map(({ name, field, match, since }) => {
      const { path, carried } = documentPath(projection, field);
      return { name: canonicalise(name), field, match, property: carried ? path : null, since };
    }),
    paging: projection.page_size ? { pageSize: projection.page_size, pageMax: projection.page_max } : null,
    nests: projection.nests.map(toNest),
  };
}

function toNest(nest) {
  return {
    name: nest.name,
    lookup: nest.lookup,
    entity: reference(nest.entity_name, nest.entity_version),
    on: nest.on.map(({ field, parent_field }) => ({ field, parentField: parent_field })),
    fields: toFields(nest),
    order: toOrder(nest.order),
    nests: nest.nests.map(toNest),
    since: nest.since,
  };
}

function toFields({ selection, aliases, fields_since }) {
  return selection ? selection.map((field, index) => ({ field, as: aliases[index], since: fields_since?.[index] ?? null })) : null;
}

function toOrder(order) {
  return order.map(({ field, direction, nulls }) => ({ field, direction, nulls }));
}

function reference(name, version) {
  return name === null ? null : { name, version };
}

export { routes, paths, schemas };
