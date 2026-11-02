const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const bundleSchema = require('./bundle-schema.json');

const FORMATS = [1];
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const NUMERIC = /^(bigint|int8|numeric|decimal)\b/i;

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(bundleSchema);

function validateBundle(bundle) {
  if (!FORMATS.includes(bundle?.format)) throw new Error(`Unsupported bundle format ${JSON.stringify(bundle?.format)}; supported formats are ${FORMATS.join(', ')}`);
  if (!validate(bundle)) throw new Error(`Invalid bundle\n${validate.errors.map(({ instancePath, message }) => `${instancePath || '/'} ${message}`).join('\n')}`);
}

function packageVersion(bundle) {
  const latest = Math.max(0, ...bundle.changeSets.map(({ id }) => id));
  return `${bundle.version}.${latest}.0`;
}

function pack(bundle, { name, out }) {
  validateBundle(bundle);
  const version = packageVersion(bundle);
  const files = {
    'package.json': `${JSON.stringify({ name, version, description: bundle.description ?? `${bundle.name} v${bundle.version}`, main: 'index.js', types: 'index.d.ts' }, null, 2)}\n`,
    'index.js': "module.exports = require('./runtime')(require('./bundle.json'));\n",
    'runtime.js': fs.readFileSync(path.join(__dirname, 'bundle-runtime.js'), 'utf8'),
    'index.d.ts': declarations(bundle),
    'bundle.json': JSON.stringify(bundle),
  };
  fs.mkdirSync(out, { recursive: true });
  for (const [filename, content] of Object.entries(files)) fs.writeFileSync(path.join(out, filename), content);
  return { name, version };
}

function declarations(bundle) {
  return `export type ProjectionDocument = ${tsType(bundle.schema, '')};

export interface ChangeSet {
  id: number;
  effective: Date;
  description: string;
  lastModified: Date;
  entityTag: string;
  reissuedFrom?: number;
}

export interface Parameters {
${bundle.parameters.flatMap((parameter) => parameterProperties(parameter, bundle.schema.properties[parameter.field])).join('\n')}
}

export type Instant = Date | string | number;

export const name: ${JSON.stringify(bundle.name)};
export const version: ${bundle.version};
export const description: ${bundle.description === null ? 'null' : JSON.stringify(bundle.description)};
export const changeSets: ChangeSet[];
export function asOf(instant: Instant): ChangeSet | undefined;
export function getDocuments(changeSetId: number, parameters?: Parameters): ProjectionDocument[];
export function getCurrentDocuments(parameters?: Parameters, instant?: Instant): ProjectionDocument[];
`;
}

function parameterProperties({ name, match, type }, schema = {}) {
  const base = NUMERIC.test(type) ? 'number | string' : parameterType(schema);
  const property = (key, type) => `  ${propertyName(key)}?: ${type} | null;`;
  if (match === 'range') return [property(`${name}_from`, base), property(`${name}_to`, base)];
  if (match === 'in') return [property(name, `Array<${base}>`)];
  if (match === 'prefix') return [property(name, 'string')];
  return [property(name, base)];
}

function parameterType(schema) {
  const value = schema.anyOf ? schema.anyOf.find((option) => option.type !== 'null') : { ...schema, type: [].concat(schema.type ?? []).filter((type) => type !== 'null') };
  if (value.format === 'date-time') return 'Date | string';
  return tsType(value, '');
}

function tsType(schema = {}, indent) {
  if (schema.anyOf) return schema.anyOf.map((option) => tsType(option, indent)).join(' | ');
  if (schema.enum) return schema.enum.map((value) => JSON.stringify(value)).join(' | ');
  const types = [].concat(schema.type ?? []);
  if (types.length === 0) return 'unknown';
  return types.map((type) => singleType(type, schema, indent)).join(' | ');
}

function singleType(type, schema, indent) {
  switch (type) {
    case 'null': return 'null';
    case 'string': return schema.format === 'date-time' ? 'Date' : 'string';
    case 'integer':
    case 'number': return 'number';
    case 'boolean': return 'boolean';
    case 'array': return `Array<${tsType(schema.items, indent)}>`;
    case 'object': return objectType(schema, indent);
    default: return 'unknown';
  }
}

function objectType({ properties }, indent) {
  if (!properties) return 'Record<string, unknown>';
  const inner = `${indent}  `;
  const lines = Object.entries(properties).map(([name, schema]) => `${inner}${propertyName(name)}: ${tsType(schema, inner)};`);
  return `{\n${lines.join('\n')}\n${indent}}`;
}

function propertyName(name) {
  return IDENTIFIER.test(name) ? name : JSON.stringify(name);
}

module.exports = { pack, validateBundle, packageVersion, declarations };
