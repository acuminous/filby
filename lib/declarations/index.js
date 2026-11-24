import { handle, json } from '../handler.js';
import projections from './projections.js';
import entities from './entities.js';

const ROUTES = [
  ...projections.routes,
  ...entities.routes,
];

const PATHS = {
  ...projections.paths,
  ...entities.paths,
};

const SCHEMAS = {
  ...projections.schemas,
  ...entities.schemas,
};

const STRING = { type: 'string' };
const INTEGER = { type: 'integer' };

const ENTITY_REFERENCE = {
  type: 'object',
  properties: { name: STRING, version: INTEGER },
  required: ['name', 'version'],
  additionalProperties: false,
};

const ERROR = {
  type: 'object',
  properties: { error: STRING },
  required: ['error'],
  additionalProperties: false,
};

export default async function fetchDeclarations(filby, request, { basePath = '', info = { title: 'Filby', version: '1.0.0' } } = {}) {
  return handle(request, basePath, (pathname, base) => {
    if (pathname === '/openapi.json') return async () => respond(openapi(base, info));
    const route = ROUTES.find(([pattern]) => pattern.test(pathname));
    return route && (async () => respond(await route[1](filby, pathname.match(route[0]))));
  });
}

function respond(body) {
  return json(200, body, { 'Cache-Control': 'no-cache' });
}

function openapi(basePath, info) {
  return {
    openapi: '3.1.0',
    info,
    ...(basePath ? { servers: [{ url: basePath }] } : {}),
    paths: PATHS,
    components: { schemas: { EntityReference: ENTITY_REFERENCE, Error: ERROR, ...SCHEMAS } },
  };
}
