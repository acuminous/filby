const path = require('node:path');

const YAML = require('yaml');

const compile = require('./compile-template');
const validate = require('./validate-migration');
const createValidator = require('./data-validator');
const { frameRows } = require('./helpers');

module.exports = (migration, validator = createValidator()) => {
  const fileType = path.extname(migration.filename).replace(/^\./, '');
  switch (fileType) {
    case 'sql': return migration.script;
    case 'json': return getSql(JSON.parse, migration, validator);
    case 'yml':
    case 'yaml': return getSql(parseYaml, migration, validator);
    default: throw new Error(`Unsupported file type: ${fileType}`);
  }
};

function parseYaml(script) {
  return YAML.parse(script, { schema: 'core' });
}

function getSql(parseFn, migration, validator) {
  const document = canonicaliseActions(parseFn(migration.script));
  validate(migration.filename, document);
  const script = document.map(normalise);
  script.forEach((instruction, index) => {
    loadFrames(migration, document, instruction, index);
    validator.apply(instruction);
  });
  return renderSql(migration, script);
}

function loadFrames({ filename, directory }, document, instruction, index) {
  if (instruction.operation !== 'ADD_CHANGE_SET') return;
  const property = document[index].changes ? 'changes' : 'frames';
  instruction.frames.forEach((frame, frameIndex) => {
    const pointer = `${filename}: /${index}/${property}/${frameIndex}/data`;
    Object.assign(frame, frameRows(frame, { directory, pointer }));
  });
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

function normalise(instruction) {
  switch (instruction.operation) {
    case 'ADD_ENTITY': return normaliseEntity(instruction);
    case 'ADD_PROJECTION': return normaliseProjection(instruction);
    case 'ADD_HOOK': return normaliseHook(instruction);
    case 'ADD_CHANGE_SET': return normaliseChangeSet(instruction);
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

function normaliseProjection({ version = 1, dependencies, ...instruction }) {
  return { ...instruction, version, dependencies: dependencies.map((dependency) => normaliseReference('entity', dependency)) };
}

function normaliseHook(instruction) {
  return instruction.projection === undefined ? instruction : normaliseReference('projection', instruction);
}

function normaliseChangeSet({ changes, frames, ...instruction }) {
  const frameList = exclusive(`Change set '${instruction.description}'`, { changes, frames });
  return { ...instruction, frames: frameList.map((frame) => normaliseReference('entity', frame)) };
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
  const data = { filename, directory };
  const render = compile(__dirname, 'template.hbs');
  return render(script, { data });
}
