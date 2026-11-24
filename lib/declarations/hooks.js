import { HttpError, decode } from '../handler.js';

const STRING = { type: 'string' };
const INTEGER = { type: 'integer' };
const HOOK_PATH = /^\/hooks\/([^/]+)$/;

const routes = [
  [/^\/hooks$/, listHooks],
  [HOOK_PATH, getHook],
];

const paths = {
  '/hooks': {
    get: {
      operationId: 'listHookDeclarations',
      summary: 'Hooks',
      description: 'The hooks, ordered by name',
      responses: {
        200: response('The hooks', { type: 'array', items: { $ref: '#/components/schemas/HookDeclaration' } }),
      },
    },
  },
  '/hooks/{name}': {
    get: {
      operationId: 'getHookDeclaration',
      summary: 'Hook declaration',
      description: 'How the migrations declared the hook',
      parameters: [{ name: 'name', in: 'path', required: true, description: 'The hook name, URL-encoded including any /', schema: STRING }],
      responses: {
        200: response('The hook declaration', { $ref: '#/components/schemas/HookDeclaration' }),
        400: errorResponse('A hook name that cannot be URL-decoded'),
        404: errorResponse('The hook does not exist'),
      },
    },
  },
};

const schemas = {
  HookDeclaration: object({
    name: STRING,
    description: { type: ['string', 'null'] },
    event: { enum: ['ADD_PROJECTION', 'DROP_PROJECTION', 'ADD_CHANGE_SET', 'COMMENCE_CHANGE_SET'] },
    projection: { anyOf: [{ $ref: '#/components/schemas/ProjectionReference' }, { type: 'null' }] },
  }),
  ProjectionReference: object({ name: STRING, version: INTEGER }),
};

const SELECT_HOOKS = `
  SELECT h.name, h.description, h.event, p.name AS projection_name, p.version AS projection_version
  FROM fby_hook h
  LEFT JOIN fby_projection p ON p.id = h.projection_id`;

async function listHooks(filby) {
  const { rows } = await filby.withTransaction((tx) => tx.query(`${SELECT_HOOKS} ORDER BY h.name`));
  return rows.map(toDeclaration);
}

async function getHook(filby, [, encoded]) {
  const name = decode(encoded, 'hook');
  const { rows } = await filby.withTransaction((tx) => tx.query(`${SELECT_HOOKS} WHERE h.name = $1`, [name]));
  if (!rows.length) throw new HttpError(404, `Hook '${name}' does not exist`);
  return toDeclaration(rows[0]);
}

function toDeclaration({ name, description, event, projection_name, projection_version }) {
  return { name, description, event, projection: projection_name === null ? null : { name: projection_name, version: projection_version } };
}

function object(properties) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

function response(description, schema) {
  return { description, headers: { 'Cache-Control': { schema: STRING } }, content: { 'application/json': { schema } } };
}

function errorResponse(description) {
  return { description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
}

export default { routes, paths, schemas };
