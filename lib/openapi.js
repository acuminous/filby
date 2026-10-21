const { projectionFunction, projectionArguments } = require('./helpers');

const RESERVED = ['changeSetId', 'page', 'pageSize'];
const INTEGER = { type: 'integer' };
const STRING = { type: 'string' };
const NUMBER = { type: 'number' };
const BOOLEAN = { type: 'boolean' };
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
  date: DATE_TIME,
  timestamp: DATE_TIME,
  timestamptz: DATE_TIME,
  'timestamp with time zone': DATE_TIME,
  'timestamp without time zone': DATE_TIME,
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

const ETAG = { description: 'The entity tag of the change set', schema: STRING };
const LAST_MODIFIED = { description: 'When the change set was last modified, in RFC 1123 format', schema: STRING };

module.exports = async function openapi(filby, { basePath = '', info = { title: 'Filby', version: '1.0.0' } } = {}) {
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
};

async function load(filby) {
  return filby.withTransaction(async (tx) => {
    const { rows: projections } = await tx.query('SELECT id, name, version, description, root_entity_id, page_size, page_max FROM fby_projection ORDER BY name, version');
    const { rows: parameters } = await tx.query('SELECT projection_id, name, field, match FROM fby_projection_parameter ORDER BY projection_id, position');
    const { rows: nests } = await tx.query('SELECT id, projection_id, parent_nest_id, name, entity_id FROM fby_projection_nest ORDER BY projection_id, position');
    const { rows: on } = await tx.query('SELECT nest_id, field FROM fby_projection_nest_on ORDER BY nest_id, position');
    const { rows: fields } = await tx.query('SELECT entity_id, name, type, nullable FROM fby_entity_field ORDER BY entity_id, position');
    const { rows: values } = await tx.query('SELECT name, value FROM fby_enum ORDER BY name, position');
    const enums = Object.fromEntries(Object.entries(Object.groupBy(values, ({ name }) => name)).map(([name, rows]) => [name, rows.map(({ value }) => value)]));
    const nestTree = (projectionId, parentNestId) => nests
      .filter(({ projection_id, parent_nest_id }) => projection_id === projectionId && parent_nest_id === parentNestId)
      .map((nest) => ({
        ...nest,
        on: on.filter(({ nest_id }) => nest_id === nest.id),
        fields: fields.filter(({ entity_id }) => entity_id === nest.entity_id),
        nests: nestTree(projectionId, nest.id),
      }));
    return {
      enums,
      projections: projections.map((projection) => ({
        ...projection,
        fields: fields.filter(({ entity_id }) => entity_id === projection.root_entity_id),
        parameters: parameters.filter(({ projection_id }) => projection_id === projection.id),
        nests: nestTree(projection.id, null),
      })),
    };
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
      ],
      responses: {
        200: response('The change sets of the projection', { type: 'array', items: { $ref: '#/components/schemas/ChangeSet' } }, { ETag: ETAG, 'Last-Modified': LAST_MODIFIED }),
        400: errorResponse('A missing or malformed query parameter'),
        404: errorResponse('The projection does not exist'),
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
      parameters: [queryParameter('changeSetId', INTEGER), ...declaredParameters(projection, enums), ...pagingParameters(projection)],
      responses: {
        200: response(`The documents of ${key} at the change set`, { type: 'array', items: schema }, {
          ETag: ETAG,
          'Last-Modified': LAST_MODIFIED,
          'Cache-Control': { schema: STRING },
          'X-Total-Count': { description: 'The number of documents that matched the parameters, whatever the page', schema: INTEGER },
          Link: { description: 'The next and previous pages, where they exist', schema: STRING },
        }),
        307: { description: 'Redirects to the same URL with changeSetId set to the current change set', headers: { Location: { schema: STRING } } },
        400: errorResponse('A missing or malformed query parameter, or a change set that does not exist'),
        404: errorResponse('The projection does not exist or has no current change set'),
      },
    },
  };
}

function declaredParameters({ parameters, fields }, enums) {
  return parameters
    .flatMap((parameter) => projectionArguments(parameter).map(({ name, array }) => ({ name: name.slice(2), array, field: parameter.field })))
    .filter(({ name }) => !RESERVED.includes(name))
    .map(({ name, array, field }) => {
      const schema = typeSchema(fields.find((candidate) => candidate.name === field).type, enums);
      return array ? queryParameter(name, { type: 'array', items: schema }, { style: 'form', explode: true }) : queryParameter(name, schema);
    });
}

function pagingParameters({ root_entity_id, page_size, page_max }) {
  if (root_entity_id && !page_size) return [];
  const pageSize = page_size ? { type: 'integer', minimum: 1, default: page_size, maximum: page_max } : { type: 'integer', minimum: 1 };
  return [queryParameter('page', { type: 'integer', minimum: 1 }), queryParameter('pageSize', pageSize)];
}

function documentSchema({ fields, nests }, enums) {
  const schema = objectSchema(fields, enums);
  for (const nest of nests) {
    const children = nest.fields.filter(({ name }) => !nest.on.some(({ field }) => field === name));
    schema.properties[nest.name] = { type: 'array', items: documentSchema({ fields: children, nests: nest.nests }, enums) };
    schema.required.push(nest.name);
  }
  return schema;
}

function objectSchema(fields, enums) {
  return {
    type: 'object',
    properties: Object.fromEntries(fields.map((field) => [field.name, fieldSchema(field, enums)])),
    required: fields.filter(({ nullable }) => !nullable).map(({ name }) => name),
    additionalProperties: false,
  };
}

function fieldSchema({ type, nullable }, enums) {
  const schema = typeSchema(type, enums);
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
