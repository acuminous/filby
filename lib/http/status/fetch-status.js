import { handle, json } from '../handler.js';
import * as hooks from './hooks.js';

const ROUTES = [
  ...hooks.routes,
];

const PATHS = {
  ...hooks.paths,
};

const SCHEMAS = {
  ...hooks.schemas,
};

const STRING = { type: 'string' };
const INTEGER = { type: 'integer' };

const PROJECTION_REFERENCE = {
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

export async function fetchStatus(filby, request, { basePath = '', info = { title: 'Filby', version: '1.0.0' } } = {}, instance) {
  return handle(request, basePath, (pathname, base) => {
    if (pathname === '/openapi.json') return async () => respond(openapi(base, info));
    const route = ROUTES.find(([pattern]) => pattern.test(pathname));
    return route && (async () => respond(await route[1](filby, pathname.match(route[0]), instance)));
  });
}

function respond(body) {
  return json(200, body, { 'Cache-Control': 'no-store' });
}

function openapi(basePath, info) {
  return {
    openapi: '3.1.0',
    info,
    ...(basePath ? { servers: [{ url: basePath }] } : {}),
    paths: PATHS,
    components: { schemas: { ProjectionReference: PROJECTION_REFERENCE, Error: ERROR, ...SCHEMAS } },
  };
}
