const { ok, strictEqual: eq, deepEqual: deq, rejects, match, throws } = require('node:assert');
const { describe, it, before, beforeEach, after, afterEach } = require('zunit');

const compileTemplate = require('../lib/compile-template');

describe('Compile Template', () => {

  it('should prevent unescaped valued', () => {
    const render = compileTemplate(__dirname, 'bad-template.hbs');
    throws(() => render({ text: 'unescaped' }), (err) => {
      eq(err.message, "Unescaped expression 'unescaped' in Handlebars template");
      return true;
    });
  });
});
