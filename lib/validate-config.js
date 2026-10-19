const Ajv = require('ajv');

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
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

const ajv = new Ajv({ allErrors: true });

const validate = ajv.compile(schema);

module.exports = (config) => {
  if (!validate(config)) {
    const message = validate.errors.map(getErrorMessage).join('\n');
    const err = new Error(message);
    Object.assign(err, { details: validate.errors });
    throw err;
  }
};

function getErrorMessage({ keyword, instancePath, params, message }) {
  const location = instancePath || '/';
  switch (keyword) {
    case 'additionalProperties': return `Invalid config: ${location} must NOT have additional property '${params.additionalProperty}'`;
    default: return `Invalid config: ${location} ${message}`;
  }
}
