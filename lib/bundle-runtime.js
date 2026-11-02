const NUMERIC = /^(bigint|int8|numeric|decimal)\b/i;

module.exports = function runtime(bundle) {
  const key = `${bundle.name} v${bundle.version}`;
  const changeSets = bundle.changeSets.map((changeSet) => ({ ...changeSet, effective: new Date(changeSet.effective), lastModified: new Date(changeSet.lastModified) }));
  const filters = bundle.parameters.flatMap((parameter) => parameterFilters(parameter, bundle.schema.properties[parameter.field]));
  const names = filters.map(({ name }) => name);

  function asOf(instant) {
    const time = new Date(instant).getTime();
    if (Number.isNaN(time)) throw new TypeError(`Invalid instant '${instant}'`);
    return changeSets.filter(({ effective }) => effective.getTime() <= time).sort((a, b) => b.effective - a.effective || b.id - a.id)[0];
  }

  function getDocuments(changeSetId, parameters = {}) {
    const unknown = Object.keys(parameters).find((name) => !names.includes(name));
    if (unknown) throw new Error(`Projection '${key}' has no parameter '${unknown}'${parameterHint(names)}`);
    if (!Object.hasOwn(bundle.documents, changeSetId)) throw new Error(`Change set ${changeSetId} does not exist`);
    const active = filters.filter(({ name }) => parameters[name] !== undefined && parameters[name] !== null);
    return bundle.documents[changeSetId]
      .filter((document) => active.every(({ name, test }) => test(document, parameters[name])))
      .map((document) => revive(document, bundle.schema));
  }

  function getCurrentDocuments(parameters = {}, instant = new Date()) {
    const changeSet = asOf(instant);
    if (!changeSet) throw new Error(`Projection '${key}' has no change set in force at ${new Date(instant).toISOString()}`);
    return getDocuments(changeSet.id, parameters);
  }

  return { name: bundle.name, version: bundle.version, description: bundle.description, changeSets, asOf, getDocuments, getCurrentDocuments };
};

function parameterFilters({ name, field, match, type }, schema) {
  const convert = converter(nonNull(schema), type);
  const compare = (document, value) => {
    const left = document[field];
    if (left === null || left === undefined) return Number.NaN;
    const [a, b] = [convert(left), convert(value)];
    if (a === b) return 0;
    if (a < b) return -1;
    if (a > b) return 1;
    return Number.NaN;
  };
  switch (match) {
    case 'prefix': return [{ name, test: (document, value) => typeof document[field] === 'string' && document[field].startsWith(String(value)) }];
    case 'in': return [{ name, test: (document, values) => values.some((value) => compare(document, value) === 0) }];
    case 'range': return [
      { name: `${name}_from`, test: (document, value) => compare(document, value) >= 0 },
      { name: `${name}_to`, test: (document, value) => compare(document, value) <= 0 },
    ];
    case 'gt': return [{ name, test: (document, value) => compare(document, value) > 0 }];
    case 'gte': return [{ name, test: (document, value) => compare(document, value) >= 0 }];
    case 'lt': return [{ name, test: (document, value) => compare(document, value) < 0 }];
    case 'lte': return [{ name, test: (document, value) => compare(document, value) <= 0 }];
    default: return [{ name, test: (document, value) => compare(document, value) === 0 }];
  }
}

function converter(schema, type) {
  if (schema.format === 'date-time') return (value) => new Date(value).getTime();
  if (schema.type === 'integer' || schema.type === 'number' || NUMERIC.test(type)) return Number;
  if (schema.type === 'boolean') return (value) => value === true || value === 'true';
  return String;
}

function nonNull(schema = {}) {
  if (schema.anyOf) return schema.anyOf.find((option) => option.type !== 'null') ?? {};
  if (Array.isArray(schema.type)) return { ...schema, type: schema.type.find((type) => type !== 'null') };
  return schema;
}

function revive(value, schema = {}) {
  if (value === null || value === undefined) return value;
  if (schema.anyOf) return revive(value, nonNull(schema));
  if (schema.format === 'date-time' && typeof value === 'string') return new Date(value);
  if (Array.isArray(value)) return value.map((item) => revive(item, schema.items));
  if (typeof value === 'object') return schema.properties ? Object.fromEntries(Object.entries(value).map(([name, item]) => [name, revive(item, schema.properties[name])])) : structuredClone(value);
  return value;
}

function parameterHint(names) {
  return names.length ? `; existing parameters are ${names.map((name) => `'${name}'`).join(', ')}` : '';
}
