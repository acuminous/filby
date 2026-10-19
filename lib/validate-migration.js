const Ajv = require('ajv');
const ajvFormats = require('ajv-formats');

const schema = require('./schema.json');
const { isBareDate } = require('./helpers');

const ajv = new Ajv();
ajvFormats(ajv);

const validate = ajv.compile(schema);

module.exports = (filename, script) => {
  if (!validate(script)) {
    const message = humanise(filename, validate.errors);
    const err = new Error(message);
    Object.assign(err, { details: validate.errors });
    throw err;
  }
  script.forEach((instruction, index) => {
    if (instruction.operation !== 'ADD_CHANGE_SET') return;
    if (!isBareDate(instruction.effective) || instruction.timezone !== undefined) return;
    throw new Error(`${filename}: /${index}/effective '${instruction.effective}' is a calendar date in the change set's timezone, but the change set has no timezone. Filby never uses the process timezone, because the same file would render differently on different machines. Add 'timezone' (an IANA name such as 'Europe/London') to the change set, or give 'effective' an explicit offset such as '${instruction.effective}T00:00:00Z'`);
  });
};

function humanise(filename, errors) {
  if (errors.length === 1) return getErrorMessage(filename, errors[0]);
  if (errors.find(byCriteria({ schemaPath: '#/items/allOf/1/anyOf' }))) {
    const candidates = errors
      .filter(out(byCriteria({ schemaPath: '#/items/allOf/1/anyOf' })))
      .filter(out(byCriteria({ keyword: 'const' })));
    return humanise(filename, candidates);
  }
  if (errors.find(byCriteria({ schemaPath: '#/properties/effective/anyOf' }))) {
    const candidates = errors
      .filter(out(byCriteria({ schemaPath: '#/properties/effective/anyOf' })))
      .reduce(toAggregatedErrors, []);
    return humanise(filename, candidates);
  }
  if (errors.find(byCriteria({ schemaPath: '#/properties/frames/items/oneOf' }))) {
    const candidates = errors
      .filter(out(byCriteria({ schemaPath: '#/properties/frames/items/oneOf' })))
      .reduce(toAggregatedErrors, []);
    return humanise(filename, candidates);
  }
  return errors.map((error) => getErrorMessage(filename, error)).join('\n');
}

function byCriteria(criteria) {
  return (error) => {
    if (criteria.schemaPath !== undefined && criteria.schemaPath !== error.schemaPath) return false;
    if (criteria.keyword !== undefined && criteria.keyword !== error.keyword) return false;
    return true;
  };
}

function out(fn) {
  return (error) => {
    return !(fn(error));
  };
}

function toAggregatedErrors(aggregates, error) {
  let entry = aggregates.find(byCriteria({ instancePath: error.instancePath, keyword: error.keyword }));
  if (!entry) {
    entry = { instancePath: error.instancePath, keyword: error.keyword, params: {} };
    aggregates.push(entry);
  }
  Object.keys(error.params).forEach((key) => {
    entry.params[key] = dedupe(entry.params[key], error.params[key]);
  });
  return aggregates;
}

function dedupe(list, item) {
  return Array.from(new Set(list).add(item));
}

function getErrorMessage(filename, { keyword, instancePath, params, message }) {
  switch (keyword) {
    case 'additionalProperties': return `${filename}: ${instancePath} must NOT have additional property '${params.additionalProperty}'`;
    case 'enum': return `${filename}: ${instancePath} ${message} ${formatList(params.allowedValues, 'or')}`;
    case 'format': return `${filename}: ${instancePath} must match format ${formatList(params.format, 'or')}`;
    case 'minItems': return `${filename}: ${instancePath} ${message}`;
    case 'required': return `${filename}: ${instancePath} must have required property ${formatList(params.missingProperty, 'or')}`;
    case 'type': return `${filename}: ${instancePath} must be of type ${formatList(params.type, 'or')}`;
    default: return `${filename}: ${instancePath} ${message}`;
  }
}

function formatList(items, conjunction) {
  return [].concat(items).map(toQuotedItem).reduce((output, item, index) => {
    if (isLast(items, index)) return `${output} ${conjunction} ${item}`;
    return `${output}, ${item}`;
  });
}

function toQuotedItem(item) {
  return `'${item}'`;
}

function isLast(items, index) {
  return items.length === index + 1;
}
