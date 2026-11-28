import { HttpError, decode } from '../handler.js';
import { STRING, INTEGER, CACHE_CONTROL_HEADERS, PROJECTION_REFERENCE, object, response, errorResponse } from '../openapi.js';

const ENTITY_PATH = /^\/entities\/([^/]+)\/v(\d+)$/;

const BOOLEAN = { type: 'boolean' };
const DESCRIPTION = { type: ['string', 'null'] };

const routes = [
  [/^\/entities$/, listEntities],
  [ENTITY_PATH, getEntity],
];

const paths = {
  '/entities': {
    get: {
      operationId: 'listEntityDeclarations',
      summary: 'Entities',
      description: 'The entities, ordered by name then version',
      responses: {
        200: response('The entities', { type: 'array', items: { $ref: '#/components/schemas/EntitySummary' } }, CACHE_CONTROL_HEADERS),
      },
    },
  },
  '/entities/{name}/v{version}': {
    get: {
      operationId: 'getEntityDeclaration',
      summary: 'Entity declaration',
      description: 'How the migrations declared the entity',
      parameters: [
        { name: 'name', in: 'path', required: true, description: 'The entity name, URL-encoded', schema: STRING },
        { name: 'version', in: 'path', required: true, schema: INTEGER },
      ],
      responses: {
        200: response('The entity declaration', { $ref: '#/components/schemas/EntityDeclaration' }, CACHE_CONTROL_HEADERS),
        400: errorResponse('An entity name that cannot be URL-decoded, or a version that is too large'),
        404: errorResponse('The entity does not exist'),
      },
    },
  },
};

const schemas = {
  EntitySummary: object({ name: STRING, version: INTEGER, description: DESCRIPTION }),
  EntityDeclaration: object({
    name: STRING,
    version: INTEGER,
    description: DESCRIPTION,
    fields: { type: 'array', items: { $ref: '#/components/schemas/EntityField' } },
    checks: { type: 'array', items: { $ref: '#/components/schemas/EntityCheck' } },
    projections: { type: 'array', items: { $ref: '#/components/schemas/ProjectionReference' } },
  }),
  EntityField: object({ name: STRING, type: STRING, key: BOOLEAN, nullable: BOOLEAN, since: { type: ['integer', 'null'] } }),
  EntityCheck: object({ name: STRING, expression: STRING }),
  ProjectionReference: PROJECTION_REFERENCE,
};

async function listEntities(filby) {
  const { rows } = await filby.withTransaction((tx) => tx.query('SELECT name, version, description FROM fby_entity ORDER BY name, version'));
  return rows;
}

async function getEntity(filby, [, name, version]) {
  return filby.withTransaction(async (tx) => {
    const entity = await findEntity(tx, decode(name, 'entity'), Number(version));
    const { rows: fields } = await tx.query('SELECT name, type, identity AS key, nullable, since FROM fby_entity_field WHERE entity_id = $1 ORDER BY position', [entity.id]);
    const { rows: checks } = await tx.query('SELECT name, expression FROM fby_entity_check WHERE entity_id = $1 ORDER BY name', [entity.id]);
    const { rows: projections } = await tx.query(`
      SELECT p.name, p.version
      FROM fby_projection p
      INNER JOIN fby_projection_entity pe ON pe.projection_id = p.id
      WHERE pe.entity_id = $1
        AND p.dropped_at IS NULL
      ORDER BY p.name, p.version`, [entity.id]);
    return { name: entity.name, version: entity.version, description: entity.description, fields, checks, projections };
  });
}

async function findEntity(tx, name, version) {
  const { rows } = await tx.query('SELECT id, name, version, description FROM fby_entity WHERE name = $1 AND version = $2 FOR SHARE', [name, version]);
  if (!rows.length) throw new HttpError(404, `Entity '${name} v${version}' does not exist`);
  return rows[0];
}

export { routes, paths, schemas };
