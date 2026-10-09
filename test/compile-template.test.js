const { strictEqual: eq, throws } = require('node:assert');
const { describe, it } = require('node:test');

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
