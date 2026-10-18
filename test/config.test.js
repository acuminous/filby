const { throws, doesNotThrow } = require('node:assert');
const { describe, it } = require('node:test');

const { Filby } = require('..');

describe('Config', () => {

  it('should accept a valid config', () => {
    doesNotThrow(() => new Filby({
      database: { user: 'fby_test', password: 'fby_test' },
      migrations: ['test/migrations', 'test/data'],
      checksums: 'error',
      notifications: { interval: '1m', initialDelay: '1s', maxAttempts: 10, maxRescheduleDelay: '1h' },
    }));
  });

  it('should accept an empty config', () => {
    doesNotThrow(() => new Filby({}));
  });

  it('should reject unknown notifications keys', () => {
    throws(() => new Filby({ notifications: { intialDelay: '1s' } }), { message: "Invalid config: /notifications must NOT have additional property 'intialDelay'" });
  });

  it('should reject unknown top level keys', () => {
    throws(() => new Filby({ notification: {} }), { message: "Invalid config: / must NOT have additional property 'notification'" });
  });

  it('should reject migrations that are not paths', () => {
    throws(() => new Filby({ migrations: [{ path: 'migrations', permissions: ['ALL'] }] }), { message: 'Invalid config: /migrations/0 must be string' });
  });

  it('should accept each checksums mode', () => {
    for (const checksums of ['ignore', 'warn', 'error']) {
      doesNotThrow(() => new Filby({ checksums }));
    }
  });

  it('should reject unknown checksums modes', () => {
    throws(() => new Filby({ checksums: 'strict' }), { message: 'Invalid config: /checksums must be equal to one of the allowed values' });
  });

  it('should allow any database keys', () => {
    doesNotThrow(() => new Filby({ database: { connectionString: 'postgres://localhost/fby_test', max: 5 } }));
  });
});
