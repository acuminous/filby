const path = require('node:path');

const YAML = require('yaml');

const compile = require('./compile-template');
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

function normaliseProjection({ version = 1, root, dependencies, parameters, order, paging, nest, ...instruction }) {
  const subject = `Projection '${instruction.name}'`;
  exclusive(subject, { root, dependencies });
  if (root === undefined) {
    const [unsupported] = Object.entries({ parameters, order, paging, nest }).find(([, value]) => value !== undefined) ?? [];
    if (unsupported) throw new Error(`${subject} must specify 'root' to use '${unsupported}'`);
    return { ...instruction, version, dependencies: dependencies.map((dependency) => normaliseReference('entity', dependency)) };
  }
  const rootReference = normaliseReference('entity', { entity: root });
  const nestList = toNestList(nest);
  const dependencyList = new Map([rootReference, ...flattenNests(nestList)].map(({ entity, version: entityVersion }) => [`${entity}@${entityVersion}`, { entity, version: entityVersion }]));
  return { ...instruction, version, root: rootReference, dependencies: [...dependencyList.values()], parameters: toParameterList(parameters), order: toOrderList(order), paging, nest: nestList };
}

function toParameterList(parameters = {}) {
  return Object.entries(parameters).map(([name, { match = 'equals', ...parameter }]) => ({ name, match, ...parameter }));
}

function toOrderList(order = []) {
  return order.map(({ direction = 'ASC', ...item }) => ({ direction, ...item }));
}

function toNestList(nest = {}) {
  return Object.entries(nest).map(([name, { entity, on, order, nest: children }]) => ({
    name,
    ...normaliseReference('entity', { entity }),
    on: Object.entries(on).map(([field, parentField]) => ({ field, parent_field: parentField })),
    order: toOrderList(order),
    nest: toNestList(children),
  }));
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
