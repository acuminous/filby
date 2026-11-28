const STRING = { type: 'string' };
const INTEGER = { type: 'integer' };
const CACHE_CONTROL = { schema: STRING };
const CACHE_CONTROL_HEADERS = { 'Cache-Control': CACHE_CONTROL };

const ERROR = object({ error: STRING });
const PROJECTION_REFERENCE = object({ name: STRING, version: INTEGER });
const ENTITY_REFERENCE = object({ name: STRING, version: INTEGER });

function object(properties) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

function response(description, schema, headers) {
  return { description, headers, content: { 'application/json': { schema } } };
}

function errorResponse(description) {
  return { description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
}

function document(basePath, info, paths, schemas) {
  return {
    openapi: '3.1.0',
    info,
    ...(basePath ? { servers: [{ url: basePath }] } : {}),
    paths,
    components: { schemas },
  };
}

export { STRING, INTEGER, CACHE_CONTROL, CACHE_CONTROL_HEADERS, ERROR, PROJECTION_REFERENCE, ENTITY_REFERENCE, object, response, errorResponse, document };
