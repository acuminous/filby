const Ajv = require('ajv');
const { default: parseDuration } = require('parse-duration');

const schema = {
  type: 'object',
  properties: {
    database: {
      type: 'object',
    },
    migrations: {
      type: 'array',
      items: { type: 'string' },
    },
    notifications: {
      type: 'object',
      properties: {
        interval: { type: 'string' },
        initialDelay: { type: 'string' },
        maxAttempts: { type: 'integer' },
        maxRescheduleDelay: { type: 'string' },
        handlerTimeout: { type: 'string' },
        listen: { type: 'boolean' },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

const durationKeys = ['interval', 'initialDelay', 'maxRescheduleDelay', 'handlerTimeout'];

const ajv = new Ajv({ allErrors: true });

const validate = ajv.compile(schema);

module.exports = (config) => {
  if (!validate(config)) {
    const message = validate.errors.map(getErrorMessage).join('\n');
    const err = new Error(message);
    Object.assign(err, { details: validate.errors });
    throw err;
  }
  const invalidDurations = durationKeys.filter((key) => config.notifications?.[key] !== undefined && !isDuration(config.notifications[key]));
  if (invalidDurations.length > 0) {
    throw new Error(invalidDurations.map((key) => `Invalid config: /notifications/${key} must be a duration such as '30s'`).join('\n'));
  }
};

function isDuration(value) {
  const millis = parseDuration(value);
  return Number.isFinite(millis) && millis >= 0;
}

function getErrorMessage({ keyword, instancePath, params, message }) {
  const location = instancePath || '/';
  switch (keyword) {
    case 'additionalProperties': return `Invalid config: ${location} must NOT have additional property '${params.additionalProperty}'`;
    default: return `Invalid config: ${location} ${message}`;
  }
}
