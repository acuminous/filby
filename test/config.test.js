const { throws, doesNotThrow } = require('node:assert');
const { describe, it } = require('node:test');

const { Filby } = require('..');

describe('Config', () => {

  it('should accept a valid config', () => {
    doesNotThrow(() => new Filby({
      database: { user: 'fby_test', password: 'fby_test' },
      migrations: ['test/migrations', 'test/data'],
      schema: 'filby_test_schema',
      notifications: { interval: '1m', initialDelay: '1s', maxAttempts: 10, maxRescheduleDelay: '1h', handlerTimeout: '30s', listen: true },
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

  it('should allow any database keys', () => {
    doesNotThrow(() => new Filby({ database: { connectionString: 'postgres://localhost/fby_test', max: 5 } }));
  });

  for (const key of ['interval', 'initialDelay', 'maxRescheduleDelay', 'handlerTimeout']) {
    it(`should reject an unparseable ${key}`, () => {
      throws(() => new Filby({ notifications: { [key]: 'soon' } }), { message: `Invalid config: /notifications/${key} must be a duration such as '30s'` });
    });
  }

  for (const duration of ['5s', '1m', '1h']) {
    it(`should accept a duration of ${duration}`, () => {
      doesNotThrow(() => new Filby({ notifications: { interval: duration, initialDelay: duration, maxRescheduleDelay: duration, handlerTimeout: duration } }));
    });
  }

  it('should accept a zero duration', () => {
    doesNotThrow(() => new Filby({ notifications: { initialDelay: '0ms' } }));
  });

  it('should reject a negative duration', () => {
    throws(() => new Filby({ notifications: { handlerTimeout: '-5s' } }), { message: "Invalid config: /notifications/handlerTimeout must be a duration such as '30s'" });
  });

  it('should report every unparseable duration', () => {
    throws(() => new Filby({ notifications: { handlerTimeout: '', interval: '5 bananas' } }), { message: "Invalid config: /notifications/interval must be a duration such as '30s'\nInvalid config: /notifications/handlerTimeout must be a duration such as '30s'" });
  });

  it('should reject durations that are not strings', () => {
    throws(() => new Filby({ notifications: { handlerTimeout: 30000 } }), { message: 'Invalid config: /notifications/handlerTimeout must be string' });
  });

  it('should reject a listen flag that is not a boolean', () => {
    throws(() => new Filby({ notifications: { listen: 'yes' } }), { message: 'Invalid config: /notifications/listen must be boolean' });
  });

  for (const schema of ['Public', 'my-schema', '1st', 'public; DROP SCHEMA public']) {
    it(`should reject a schema of '${schema}'`, () => {
      throws(() => new Filby({ schema }), { message: 'Invalid config: /schema must be a lower case identifier' });
    });
  }

  it('should reject a schema that is not a string', () => {
    throws(() => new Filby({ schema: 1 }), { message: 'Invalid config: /schema must be string' });
  });
});
