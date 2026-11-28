import { projectionFunction, projectionArguments } from '../../helpers.js';
import { loadProjections, documentPath } from '../../documents/projection-tree.js';

const INTEGER = { type: 'integer' };
const STRING = { type: 'string' };
const NUMBER = { type: 'number' };
const BOOLEAN = { type: 'boolean' };
const DATE = { type: 'string', format: 'date' };
const DATE_TIME = { type: 'string', format: 'date-time' };
const TYPES = {
  integer: INTEGER,
  int: INTEGER,
  int2: INTEGER,
  int4: INTEGER,
  smallint: INTEGER,
  serial: INTEGER,
  bigint: STRING,
  int8: STRING,
  numeric: STRING,
  decimal: STRING,
  real: NUMBER,
  float4: NUMBER,
  float8: NUMBER,
  'double precision': NUMBER,
  boolean: BOOLEAN,
  bool: BOOLEAN,
  date: DATE,
  timestamp: STRING,
  timestamptz: DATE_TIME,
  'timestamp with time zone': DATE_TIME,
  'timestamp without time zone': STRING,
  text: STRING,
  varchar: STRING,
  'character varying': STRING,
  char: STRING,
  character: STRING,
  uuid: { type: 'string', format: 'uuid' },
  json: {},
  jsonb: {},
};

const PROJECTION = {
  type: 'object',
  properties: {
    name: STRING,
    version: INTEGER,
    description: { type: ['string', 'null'] },
  },
  required: ['name', 'version', 'description'],
  additionalProperties: false,
};

const CHANGE_SET = {
  type: 'object',
  properties: {
    id: INTEGER,
    effective: DATE_TIME,
    description: STRING,
    lastModified: DATE_TIME,
    entityTag: STRING,
    reissuedFrom: INTEGER,
  },
  required: ['id', 'effective', 'description', 'lastModified', 'entityTag'],
  additionalProperties: false,
};

const ERROR = {
  type: 'object',
  properties: { error: STRING },
  required: ['error'],
  additionalProperties: false,
};

const ETAG = { description: 'The entity tag of the change set, in double quotes', schema: STRING };
const LAST_MODIFIED = { description: 'When the change set was last modified, in RFC 1123 format', schema: STRING };
const CACHE_CONTROL = { schema: STRING };
const IF_NONE_MATCH = { name: 'If-None-Match', in: 'header', description: 'Entity tags from earlier responses, to revalidate against the ETag', schema: STRING };
const NOT_MODIFIED = { description: 'The If-None-Match request header matches the entity tag, so there is no body', headers: { ETag: ETAG, 'Last-Modified': LAST_MODIFIED, 'Cache-Control': CACHE_CONTROL } };

export async function openapi(filby, { basePath = '', info = { title: 'Filby', version: '1.0.0' } } = {}) {
  const { projections, enums } = await load(filby);
  return {
    openapi: '3.1.0',
    info,
    ...(basePath ? { servers: [{ url: basePath }] } : {}),
    paths: {
      '/projections': projectionsPath(),
      '/changelog': changeLogPath(),
      ...Object.fromEntries(projections.map((projection) => [`/projections/${encodeURIComponent(projection.name)}/v${projection.version}`, projectionPath(projection, enums)])),
    },
    components: { schemas: { Projection: PROJECTION, ChangeSet: CHANGE_SET, Error: ERROR } },
  };
}

async function load(filby) {
  return filby.withTransaction(async (tx) => {
    const projections = await loadProjections(tx);
    const { rows: values } = await tx.query('SELECT name, value FROM fby_enum ORDER BY name, position');
    const enums = Object.fromEntries(Object.entries(Object.groupBy(values, ({ name }) => name)).map(([name, rows]) => [name, rows.map(({ value }) => value)]));
    return { projections, enums };
  });
}

function projectionsPath() {
  return {
    get: {
      operationId: 'getProjections',
      summary: 'Projections',
      description: 'The projections, ordered by name then version',
      responses: {
        200: response('The projections', { type: 'array', items: { $ref: '#/components/schemas/Projection' } }),
      },
    },
  };
}

function changeLogPath() {
  return {
    get: {
      operationId: 'getChangeLog',
      summary: 'Change log',
      description: 'The change sets of a projection, oldest first',
      parameters: [
        queryParameter('projection', STRING, { required: true }),
        queryParameter('version', INTEGER, { required: true }),
        queryParameter('since', INTEGER),
        IF_NONE_MATCH,
      ],
      responses: {
        200: response('The change sets of the projection', { type: 'array', items: { $ref: '#/components/schemas/ChangeSet' } }, { ETag: ETAG, 'Last-Modified': LAST_MODIFIED, 'Cache-Control': CACHE_CONTROL }),
        304: NOT_MODIFIED,
        400: errorResponse('A missing or malformed query parameter'),
        404: errorResponse('The projection does not exist'),
        410: errorResponse('The projection was dropped'),
      },
    },
  };
}

function projectionPath(projection, enums) {
  const key = `${projection.name} v${projection.version}`;
  const schema = projection.root_entity_id ? documentSchema(projection, enums) : { type: 'object' };
  return {
    get: {
      operationId: projectionFunction(projection.name, projection.version),
      summary: key,
      ...(projection.description ? { description: projection.description } : {}),
      parameters: [queryParameter('changeSetId', INTEGER), ...declaredParameters(projection, enums), ...pagingParameters(projection), IF_NONE_MATCH],
      responses: {
        200: response(`The documents of ${key} at the change set`, { type: 'array', items: schema }, {
          ETag: ETAG,
          'Last-Modified': LAST_MODIFIED,
          'Cache-Control': { schema: STRING },
          'X-Total-Count': { description: 'The number of documents that matched the parameters, whatever the page', schema: INTEGER },
          Link: { description: 'The next and previous pages, where they exist', schema: STRING },
        }),
        304: NOT_MODIFIED,
        307: { description: 'Redirects to the same URL with changeSetId set to the current change set', headers: { Location: { schema: STRING } } },
        400: errorResponse('A missing or malformed query parameter, or a change set that does not exist'),
        404: errorResponse('The projection does not exist or has no current change set'),
        410: errorResponse('The projection was dropped'),
      },
    },
  };
}

function declaredParameters(projection, enums) {
  return projection.parameters
    .flatMap((parameter) => projectionArguments(parameter).map(({ name, array }) => ({ name: name.slice(2), array, parameter })))
    .map(({ name, array, parameter: { field } }) => {
      const { container, name: leaf } = documentPath(projection, field);
      const { type } = container.fields.find((candidate) => candidate.name === leaf);
      const schema = typeSchema(type, enums);
      const element = schema.type === 'array' ? schema.items : schema;
      return array ? queryParameter(name, { type: 'array', items: element }, { style: 'form', explode: true }) : queryParameter(name, element);
    });
}

function pagingParameters({ page_size, page_max }) {
  const pageSize = page_size ? { type: 'integer', minimum: 1, default: page_size, maximum: page_max } : { type: 'integer', minimum: 1 };
  return [queryParameter('page', { type: 'integer', minimum: 1 }), queryParameter('pageSize', pageSize)];
}

function documentSchema({ fields, selection, aliases, fields_since, on = [], nests }, enums) {
  const carried = selection ? selection.map((field, index) => ({ ...fields.find(({ name }) => name === field), name: aliases[index], since: fields_since?.[index] ?? null })) : fields.filter(({ name }) => !on.some((join) => join.field === name));
  const schema = objectSchema(carried, enums);
  for (const nest of nests) {
    const child = documentSchema(nest, enums);
    const property = nest.lookup ? { anyOf: [child, { type: 'null' }] } : { type: 'array', items: child };
    schema.properties[nest.name] = nest.since === null ? property : { ...property, 'x-filby-since': nest.since };
    if (nest.since === null) schema.required.push(nest.name);
  }
  return schema;
}

function objectSchema(fields, enums) {
  return {
    type: 'object',
    properties: Object.fromEntries(fields.map((field) => [field.name, fieldSchema(field, enums)])),
    required: fields.filter(({ nullable, since }) => !nullable && since === null).map(({ name }) => name),
    additionalProperties: false,
  };
}

function fieldSchema({ type, nullable, since }, enums) {
  const schema = nullableSchema(typeSchema(type, enums), nullable);
  return since === null ? schema : { ...schema, 'x-filby-since': since };
}

function nullableSchema(schema, nullable) {
  if (!nullable) return schema;
  if (schema.enum) return { anyOf: [schema, { type: 'null' }] };
  if (schema.type) return { ...schema, type: [schema.type, 'null'] };
  return schema;
}

function typeSchema(type, enums) {
  const normalised = type.toLowerCase().replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  if (normalised.endsWith('[]')) return { type: 'array', items: typeSchema(normalised.slice(0, -2), enums) };
  if (enums[normalised]) return { type: 'string', enum: enums[normalised] };
  return TYPES[normalised] ?? {};
}

function queryParameter(name, schema, extra) {
  return { name, in: 'query', schema, ...extra };
}

function response(description, schema, headers) {
  return { description, headers, content: { 'application/json': { schema } } };
}

function errorResponse(description) {
  return { description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
}
