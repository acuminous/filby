const { canonical, v } = require('./helpers');

const DECIMAL = group('\\d');
const NON_DECIMAL = `0x_?${group('[\\da-f]')}|0o_?${group('[0-7]')}|0b_?${group('[01]')}`;
const INTEGER = new RegExp(`^[+-]?(${DECIMAL}|${NON_DECIMAL})$`, 'i');
const NUMERIC = new RegExp(`^[+-]?((${DECIMAL}(\\.(${DECIMAL})?)?|\\.${DECIMAL})(e[+-]?${DECIMAL})?|${NON_DECIMAL}|nan|inf|infinity)$`, 'i');
const BOOLEAN = /^(t|tr|tru|true|f|fa|fal|fals|false|y|ye|yes|n|no|on|of|off|1|0)$/i;

const families = {
  integer: ['smallint', 'integer', 'int', 'int2', 'int4', 'int8', 'bigint', 'smallserial', 'serial', 'bigserial', 'serial2', 'serial4', 'serial8'],
  numeric: ['numeric', 'decimal', 'dec', 'real', 'float', 'float4', 'float8', 'double precision'],
  boolean: ['boolean', 'bool'],
  temporal: ['date', 'time', 'timetz', 'time with time zone', 'time without time zone', 'timestamp', 'timestamptz', 'timestamp with time zone', 'timestamp without time zone', 'interval'],
};

const rules = {
  integer: (value) => (typeof value === 'number' ? Number.isInteger(value) : typeof value === 'string' && INTEGER.test(value.trim())),
  numeric: (value) => typeof value === 'number' || (typeof value === 'string' && NUMERIC.test(value.trim())),
  boolean: (value) => typeof value === 'boolean' || value === 0 || value === 1 || (typeof value === 'string' && BOOLEAN.test(value.trim())),
  temporal: (value) => typeof value === 'string' || typeof value === 'number',
};

module.exports = () => {
  const enums = new Map();
  const entities = new Map();

  function defineEnum(name, values) {
    enums.set(canonical(name), [...values]);
  }

  function extendEnum(name, values) {
    enums.get(canonical(name))?.push(...values);
  }

  function removeEnum(name) {
    enums.delete(canonical(name));
  }

  function defineEntity({ name, version, fields }) {
    const label = `${name} ${v(version)}`;
    const definitions = fields.map((field) => ({ ...field, name: canonical(field.name), ...classify(field.type) }));
    entities.set(key(name, version), { label, fields: new Map(definitions.map((field) => [field.name, field])) });
  }

  function removeEntity(name, version) {
    entities.delete(key(name, version));
  }

  function apply(instruction) {
    switch (instruction.operation) {
      case 'ADD_ENUM': return defineEnum(instruction.name, instruction.values);
      case 'ALTER_ENUM': return extendEnum(instruction.name, instruction.add);
      case 'DROP_ENUM': return removeEnum(instruction.name);
      case 'ADD_ENTITY': return defineEntity({ ...instruction, fields: instruction.fields.map((field) => ({ ...field, identity: instruction.identified_by.includes(field) })) });
      case 'DROP_ENTITY': return removeEntity(instruction.name, instruction.version);
      case 'ADD_CHANGE_SET': return instruction.frames.forEach(validateFrame);
      default: return undefined;
    }
  }

  function validateFrame(frame) {
    const entity = entities.get(key(frame.entity, frame.version));
    if (!entity) return;
    frame.columns.forEach(({ names, at }) => {
      const unknown = names.find((name) => !entity.fields.has(name));
      if (unknown) throw new Error(`${at(unknown)} references a non existent field '${unknown}' of entity '${entity.label}'`);
    });
    for (const row of frame.rows) validateRow(entity, row);
  }

  function validateRow(entity, { action, data, at }) {
    for (const field of entity.fields.values()) {
      const value = data[field.name];
      if (value === undefined || value === null) {
        if (field.identity) throw new Error(`${at()} key field '${field.name}' of entity '${entity.label}' must not be null`);
        if (!field.nullable && action === 'SET') throw new Error(`${at()} field '${field.name}' of entity '${entity.label}' must not be null`);
        continue;
      }
      const problem = check(field, value);
      if (problem) throw new Error(`${at(field.name)} value ${show(value)} for field '${field.name}' of entity '${entity.label}' ${problem}`);
    }
  }

  function check(field, value) {
    if (field.rule) return field.rule(value) ? undefined : `is not a valid ${field.type}`;
    const values = field.enum && enums.get(field.enum);
    if (values && !(isPrimitive(value) && values.includes(String(value)))) return `is not one of the ${field.type} values ${formatList(values)}`;
    return undefined;
  }

  return { defineEnum, extendEnum, removeEnum, defineEntity, removeEntity, apply };
};

function classify(type) {
  const base = type.toLowerCase().replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  if (/[[\]]|\barray$/.test(base)) return {};
  const family = Object.keys(families).find((name) => families[name].includes(base));
  if (family) return { rule: rules[family] };
  return { enum: canonical(type) };
}

function group(digits) {
  return `${digits}+(_${digits}+)*`;
}

function key(name, version) {
  return JSON.stringify([name, version]);
}

function isPrimitive(value) {
  return typeof value !== 'object';
}

function show(value) {
  return typeof value === 'string' ? `'${value}'` : JSON.stringify(value);
}

function formatList(items) {
  const quoted = items.map((item) => `'${item}'`);
  if (quoted.length === 1) return quoted[0];
  return `${quoted.slice(0, -1).join(', ')} or ${quoted.at(-1)}`;
}
