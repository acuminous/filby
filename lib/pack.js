const fs = require('node:fs');
const path = require('node:path');
const Ajv = require('ajv/dist/2020');
const addFormats = require('ajv-formats');

const bundleSchema = require('./bundle-schema.json');

const FORMATS = [1];
const MODULE_API_VERSION = 1;
const SCOPE = /^@[a-z0-9][a-z0-9._~-]*$/;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(bundleSchema);

function validateBundle(bundle) {
  if (!FORMATS.includes(bundle?.format)) throw new Error(`Unsupported bundle format ${JSON.stringify(bundle?.format)}; supported formats are ${FORMATS.join(', ')}`);
  if (!validate(bundle)) throw new Error(`Invalid bundle\n${validate.errors.map(({ instancePath, message }) => `${instancePath || '/'} ${message}`).join('\n')}`);
}

function packageName(bundle, { scope, name } = {}) {
  if (name !== undefined) return name;
  if (scope !== undefined && !SCOPE.test(scope)) throw new Error(`Scope '${scope}' is not a valid npm scope`);
  const slug = bundle.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!slug) throw new Error(`Projection '${bundle.name}' has no characters that can be used in a package name; give one with --name`);
  const base = `projection-${slug}-v${bundle.version}`;
  return scope === undefined ? base : `${scope}/${base}`;
}

function packageVersion(bundle, patch = 0) {
  const latest = Math.max(0, ...bundle.changeSets.map(({ id }) => id));
  return `${MODULE_API_VERSION}.${latest}.${patch}`;
}

function pack(bundle, { scope, name: givenName, patch, out }) {
  validateBundle(bundle);
  const name = packageName(bundle, { scope, name: givenName });
  const version = packageVersion(bundle, patch);
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

export type Instant = Date | string | number;

export const name: ${JSON.stringify(bundle.name)};
export const version: ${bundle.version};
export const description: ${bundle.description === null ? 'null' : JSON.stringify(bundle.description)};
export const changeSets: ChangeSet[];
export function asOf(instant: Instant): ChangeSet | undefined;
export function getDocuments(changeSetId: number): ProjectionDocument[];
export function getCurrentDocuments(instant?: Instant): ProjectionDocument[];
`;
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
