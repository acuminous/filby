const { strictEqual: eq, throws, doesNotThrow } = require('node:assert');
const { describe, it } = require('node:test');

const { Filby } = require('..');

describe('Config', () => {

  it('should accept a valid config', () => {
    doesNotThrow(() => new Filby({
      database: { user: 'fby_test', password: 'fby_test' },
      migrations: ['test/migrations', 'test/data'],
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

  it('should accept the deprecated migrations shape with a warning', (t) => {
    const emitWarning = t.mock.method(process, 'emitWarning', () => {});
    doesNotThrow(() => new Filby({ migrations: [{ path: 'test/migrations', permissions: ['ALL'] }, { path: 'test/data' }] }));
    eq(emitWarning.mock.callCount(), 1);
    eq(emitWarning.mock.calls[0].arguments[0], 'Configuring migrations as { path, permissions } objects is deprecated and permissions are ignored. Use a list of directory paths instead.');
    eq(emitWarning.mock.calls[0].arguments[1], 'DeprecationWarning');
  });

  it('should not warn about the current migrations shape', (t) => {
    const emitWarning = t.mock.method(process, 'emitWarning', () => {});
    new Filby({ migrations: ['test/migrations'] });
    eq(emitWarning.mock.callCount(), 0);
  });

  it('should reject migrations that are neither paths nor objects', () => {
    throws(() => new Filby({ migrations: [1] }), { message: 'Invalid config: /migrations/0 must be string,object' });
  });

  it('should require a path in deprecated migrations', (t) => {
    t.mock.method(process, 'emitWarning', () => {});
    throws(() => new Filby({ migrations: [{ permissions: ['ALL'] }] }), { message: "Invalid config: /migrations/0 must have required property 'path'" });
  });

  it('should reject unknown migrations keys', () => {
    throws(() => new Filby({ migrations: [{ path: 'migrations', permissions: ['ALL'], directory: 'migrations' }] }), { message: "Invalid config: /migrations/0 must NOT have additional property 'directory'" });
  });

  it('should allow any database keys', () => {
    doesNotThrow(() => new Filby({ database: { connectionString: 'postgres://localhost/fby_test', max: 5 } }));
  });
});
