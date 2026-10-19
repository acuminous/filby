const { strictEqual: eq, throws } = require('node:assert');
const { describe, it } = require('node:test');

const Handlebars = require('handlebars');

const hostEq = (a, b) => a === b;
const hostEscapeExpression = Handlebars.Utils.escapeExpression;
Handlebars.registerHelper('eq', hostEq);

require('..');
const compileTemplate = require('../lib/compile-template');

describe('Compile Template', () => {

  it('should prevent unescaped valued', () => {
    const render = compileTemplate(__dirname, 'bad-template.hbs');
    throws(() => render({ text: 'unescaped' }), (err) => {
      eq(err.message, "Unescaped expression 'unescaped' in Handlebars template");
      return true;
    });
  });

  it('should render escaped values', () => {
    const render = compileTemplate(__dirname, 'bad-template.hbs');
    eq(render({ text: new Handlebars.SafeString('escaped') }), 'This is a bad template escaped');
  });

  it('should leave the shared Handlebars escaping untouched', () => {
    eq(Handlebars.Utils.escapeExpression, hostEscapeExpression);
    eq(Handlebars.compile('Hello {{name}}')({ name: 'x' }), 'Hello x');
  });

  it('should leave the shared Handlebars helpers untouched', () => {
    eq(Handlebars.helpers.eq, hostEq);
    eq(Handlebars.helpers.literal, undefined);
    eq(Handlebars.helpers.partial, undefined);
  });

  it('should leave the shared Handlebars partials untouched', () => {
    eq(Handlebars.partials.insert_data_frame, undefined);
  });
});
