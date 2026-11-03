const path = require('node:path');

const YAML = require('yaml');

const compile = require('./compile-template');
const { canonical, nestPath } = require('./helpers');
const validate = require('./validate-migration');

module.exports = (migration) => {
  const fileType = path.extname(migration.filename).replace(/^\./, '');
  switch (fileType) {
    case 'sql': return migration.script;
    case 'json': return getSql(JSON.parse, migration);
    case 'yml':
    case 'yaml': return getSql(parseYaml, migration);
    default: throw new Error(`Unsupported file type: ${fileType}`);
  }
};

function parseYaml(script) {
  return YAML.parse(script, { schema: 'core' });
}

function getSql(parseFn, migration) {
  const document = canonicaliseActions(parseFn(migration.script));
  validate(migration.filename, document);
  return renderSql(migration, document.map(normalise));
}

function canonicaliseActions(document) {
  if (!Array.isArray(document)) return document;
  document.forEach((instruction) => {
    [].concat(instruction?.changes ?? [], instruction?.frames ?? []).forEach(canonicaliseAction);
  });
  return document;
}

function canonicaliseAction(frame) {
  if (typeof frame?.action === 'string') frame.action = frame.action.toUpperCase();
}

function normalise(instruction, index) {
  switch (instruction.operation) {
    case 'ADD_ENTITY': return normaliseEntity(instruction);
    case 'ADD_PROJECTION': return normaliseProjection(instruction);
    case 'ADD_HOOK': return normaliseHook(instruction);
    case 'ADD_CHANGE_SET': return normaliseChangeSet(instruction, index);
    default: return instruction;
  }
}

function normaliseEntity({ version = 1, fields, key, identified_by, ...instruction }) {
  const keyNames = exclusive(`Entity '${instruction.name}'`, { key, identified_by });
  const fieldList = toFieldList(fields).map((field) => ({ ...field, nullable: field.nullable && !keyNames.includes(field.name) }));
  const identityFields = keyNames.map((name) => {
    const field = fieldList.find((f) => f.name === name);
    if (!field) throw new Error(`Identifier '${name}' does not match one of the '${instruction.name}' entity field names`);
    return field;
  });
  return { ...instruction, version, fields: fieldList, identified_by: identityFields };
}

function toFieldList(fields) {
  if (Array.isArray(fields)) return fields.map(toField);
  return Object.entries(fields).map(([name, definition]) => toField(typeof definition === 'string' ? { name, type: definition } : { name, ...definition }));
}

function toField({ nullable = true, ...field }) {
  return { ...field, nullable };
}

function normaliseProjection({ version = 1, root, fields, dependencies, parameters, order, paging, nest, lookup, ...instruction }) {
  const subject = `Projection '${instruction.name}'`;
  exclusive(subject, { root, dependencies });
  if (root === undefined) {
    const [unsupported] = Object.entries({ fields, parameters, order, paging, nest, lookup }).find(([, value]) => value !== undefined) ?? [];
    if (unsupported) throw new Error(`${subject} must specify 'root' to use '${unsupported}'`);
    return { ...instruction, version, dependencies: dependencies.map((dependency) => normaliseReference('entity', dependency)) };
  }
  const rootReference = normaliseReference('entity', { entity: root });
  const fieldList = toSelection(fields);
  const nestList = toNestList(nest, lookup);
  const projection = `Projection '${instruction.name} v${version}'`;
  checkProperties(projection, fieldList, nestList);
  const columns = toColumns(projection, fieldList, nestList);
  const dependencyList = new Map([rootReference, ...flattenNests(nestList)].map(({ entity, version: entityVersion }) => [`${entity}@${entityVersion}`, { entity, version: entityVersion }]));
  return { ...instruction, version, root: rootReference, fields: fieldList, columns, dependencies: [...dependencyList.values()], parameters: toParameterList(projection, rootReference, nestList, parameters), order: toOrderList(order), paging, nest: nestList };
}

function toSelection(fields) {
  return fields?.map((item) => {
    const written = typeof item === 'string' ? { field: item, as: item } : { field: item.field, as: item.as };
    return { field: canonical(written.field), as: canonical(written.as), written };
  });
}

function checkProperties(projection, fields, nestList, subject = projection, parentPath = undefined) {
  const properties = new Map();
  for (const { name } of nestList) {
    const other = properties.get(canonical(name));
    if (other === name) throw new Error(`${projection} declares '${nestPath(parentPath, name)}' more than once`);
    if (other !== undefined) throw new Error(`${projection} cannot declare both '${nestPath(parentPath, other)}' and '${nestPath(parentPath, name)}'${becauseBothBecome(name)}`);
    properties.set(canonical(name), name);
  }
  for (const { as, written } of fields ?? []) {
    if (as.startsWith('fby_')) throw new Error(`${subject} property '${written.as}' uses a reserved name`);
    const other = properties.get(as);
    if (other === written.as) throw new Error(`${subject} carries more than one property named '${written.as}'`);
    if (other !== undefined) throw new Error(`${subject} cannot carry both '${other}' and '${written.as}'${becauseBothBecome(as)}`);
    properties.set(as, written.as);
  }
  for (const nest of nestList) {
    const path = nestPath(parentPath, nest.name);
    checkProperties(projection, nest.fields, nest.nest, `${projection} ${nest.lookup ? 'lookup' : 'nest'} '${path}'`, path);
  }
}

function becauseBothBecome(name) {
  return `, because both become '${canonical(name)}'`;
}

function toColumns(subject, fields, nestList) {
  if (fields === undefined) return undefined;
  const joins = new Map(nestList.flatMap((nest) => nest.on.map(({ parent_field }) => [canonical(parent_field), { nest, written: parent_field }])));
  const missing = [...joins].filter(([name]) => !fields.some(({ field, as }) => field === name && as === name));
  for (const [name, { nest, written }] of missing) {
    const property = fields.find(({ as }) => as === name);
    if (property) throw new Error(`${subject} property '${property.written.as}' has the same name as the field '${written}' that ${nest.lookup ? 'lookup' : 'nest'} '${nest.name}' joins on${property.written.as === written ? '' : becauseBothBecome(name)}`);
  }
  return [...fields, ...missing.map(([name]) => ({ field: name, as: name }))];
}

function toParameterList(projection, rootReference, nestList, parameters = {}) {
  return Object.entries(parameters).map(([name, { match = 'equals', field }]) => {
    const segments = field.split('.');
    const leaf = segments.pop();
    const nests = [];
    for (const segment of segments) {
      const siblings = nests.length ? nests.at(-1).nest : nestList;
      const nest = siblings.find((candidate) => canonical(candidate.name) === canonical(segment));
      if (!nest) throw new Error(`${projection} parameter '${name}' path '${field}' references a non existent nest or lookup '${segment}'${nestHint(siblings, nests)}`);
      nests.push(nest);
    }
    const { entity, version } = nests.at(-1) ?? rootReference;
    return { name, match, field: canonical(leaf), path: canonical(field), written: { field: leaf, path: field }, entity, version, nests };
  });
}

function nestHint(siblings, nests) {
  if (siblings.length) return `; existing nests and lookups are ${siblings.map(({ name }) => `'${name}'`).join(', ')}`;
  if (nests.length) return `; '${nests.map(({ name }) => name).join('.')}' has no nests or lookups`;
  return '; no nests or lookups exist';
}

function toOrderList(order = []) {
  return order.map(({ direction = 'ASC', ...item }) => ({ direction, ...item }));
}

function toNestList(nest = {}, lookup = {}) {
  const nestList = Object.entries(nest).map(([name, { entity, on, fields, order, nest: children, lookup: lookups }]) => ({
    name,
    ...normaliseReference('entity', { entity }),
    on: toOnList(on),
    fields: toSelection(fields),
    order: toOrderList(order),
    nest: toNestList(children, lookups),
    lookup: false,
  }));
  const lookupList = Object.entries(lookup).map(([name, { entity, on, fields }]) => ({
    name,
    ...normaliseReference('entity', { entity }),
    on: toOnList(on),
    fields: toSelection(fields),
    order: [],
    nest: [],
    lookup: true,
  }));
  return [...nestList, ...lookupList];
}

function toOnList(on) {
  return Object.entries(on).map(([field, parentField]) => ({ field, parent_field: parentField }));
}

function flattenNests(nestList) {
  return nestList.flatMap((nest) => [nest, ...flattenNests(nest.nest)]);
}

function normaliseHook(instruction) {
  return instruction.projection === undefined ? instruction : normaliseReference('projection', instruction);
}

function normaliseChangeSet({ changes, frames, ...instruction }, index) {
  const frameList = exclusive(`Change set '${instruction.description}'`, { changes, frames });
  const term = changes === undefined ? 'frames' : 'changes';
  return { ...instruction, frames: frameList.map((frame, position) => ({ ...normaliseReference('entity', frame), pointer: `/${index}/${term}/${position}` })) };
}

function normaliseReference(property, { [property]: reference, version, ...rest }) {
  const match = /^(.*)@(\d+)$/.exec(reference);
  if (!match) return { ...rest, [property]: reference, version };
  if (version !== undefined) throw new Error(`Reference '${reference}' must not also specify a version`);
  return { ...rest, [property]: match[1], version: Number(match[2]) };
}

function exclusive(subject, alternatives) {
  const specified = Object.entries(alternatives).filter(([, value]) => value !== undefined);
  if (specified.length > 1) throw new Error(`${subject} must specify either '${specified[0][0]}' or '${specified[1][0]}', not both`);
  return specified[0][1];
}

function renderSql({ filename, directory }, script) {
  const data = { filename: path.basename(filename), directory };
  const render = compile(__dirname, 'template.hbs');
  return render(script, { data });
}
