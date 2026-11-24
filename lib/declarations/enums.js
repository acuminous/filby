import { HttpError, decode } from '../handler.js';

const STRING = { type: 'string' };
const ENUM_DECLARATION = { $ref: '#/components/schemas/EnumDeclaration' };

const routes = [
  [/^\/enums$/, listEnums],
  [/^\/enums\/([^/]+)$/, getEnum],
];

const paths = {
  '/enums': {
    get: {
      operationId: 'listEnumDeclarations',
      summary: 'Enums',
      description: 'Every enum, ordered by name, with its values in declared order',
      responses: {
        200: response('The enums', { type: 'array', items: ENUM_DECLARATION }),
      },
    },
  },
  '/enums/{name}': {
    get: {
      operationId: 'getEnumDeclaration',
      summary: 'Enum declaration',
      description: 'The enum with its values in declared order',
      parameters: [
        { name: 'name', in: 'path', required: true, description: 'The canonical enum name, URL-encoded', schema: STRING },
      ],
      responses: {
        200: response('The enum declaration', ENUM_DECLARATION),
        400: errorResponse('An enum name that cannot be URL-decoded'),
        404: errorResponse('The enum does not exist'),
      },
    },
  },
};

const schemas = {
  EnumDeclaration: {
    type: 'object',
    properties: { name: STRING, values: { type: 'array', items: STRING } },
    required: ['name', 'values'],
    additionalProperties: false,
  },
};

async function listEnums(filby) {
  return filby.withTransaction((tx) => loadEnums(tx));
}

async function getEnum(filby, [, encoded]) {
  const name = decode(encoded, 'enum');
  const [declaration] = await filby.withTransaction((tx) => loadEnums(tx, name));
  if (!declaration) throw new HttpError(404, `Enum '${name}' does not exist`);
  return declaration;
}

async function loadEnums(tx, name = null) {
  const { rows } = await tx.query(`
    SELECT name, ARRAY_AGG(value ORDER BY position) AS values
    FROM fby_enum
    WHERE $1::TEXT IS NULL OR name = $1
    GROUP BY name
    ORDER BY name`, [name]);
  return rows;
}

function response(description, schema) {
  return { description, headers: { 'Cache-Control': { schema: STRING } }, content: { 'application/json': { schema } } };
}

function errorResponse(description) {
  return { description, content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
}

export default { routes, paths, schemas };
