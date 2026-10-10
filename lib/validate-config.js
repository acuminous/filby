const Ajv = require('ajv');
const addFormats = require('ajv-formats');

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const configSchema = {
  type: 'object',
  properties: {
    database: { type: 'object' },
    notifications: {
      type: 'object',
      properties: {
        interval: { type: 'string' },
        initialDelay: { type: 'string' },
        maxAttempts: { type: 'integer', minimum: 1 },
        maxRescheduleDelay: { type: 'string' },
        handlerTimeout: { type: 'string' },
      },
      additionalProperties: false,
    },
    migrations: {
      type: 'array',
    },
  },
  required: ['database'],
  additionalProperties: false,
};

const validate = ajv.compile(configSchema);

/**
 * Validates a Filby configuration object.
 * Throws an error with a readable message if the config is invalid.
 * @param {object} config - The Filby configuration object
 * @throws {Error} If the configuration is invalid
 */
function validateConfig(config) {
  const valid = validate(config);
  if (!valid) {
    const errors = validate.errors
      .map((err) => {
        const path = err.instancePath ? `config${err.instancePath}` : 'config';
        return `${path}: ${err.message}`;
      })
      .join('; ');
    throw new Error(`Invalid Filby configuration: ${errors}`);
  }
}

module.exports = { validateConfig };
