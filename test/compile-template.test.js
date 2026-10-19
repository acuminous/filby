const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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

  it('should render a large csv as a few insert statements', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'filby-'));
    const lines = ['action,type,rate'].concat(Array.from({ length: 20000 }, (_, i) => `SET,type-${i},${i}`));
    fs.writeFileSync(path.join(directory, 'vat-rates.csv'), lines.join('\n'));

    const render = compileTemplate(path.join(__dirname, '..', 'lib'), 'template.hbs');
    const sql = render([{
      operation: 'ADD_CHANGE_SET',
      description: '2020 VAT Rates',
      effective: '2020-04-05T00:00:00.000Z',
      frames: [{ entity: 'VAT Rate', version: 1, source: './vat-rates.csv' }],
    }], { data: { filename: '001.vat-rates.yaml', directory } });

    eq(count(sql, 'INSERT INTO fby_data_frame'), 20);
    eq(count(sql, 'INSERT INTO "vat_rate_v1"'), 20);
    eq(count(sql, 'fby_notify_add_change_set'), 1);

    fs.rmSync(directory, { recursive: true });
  });
});

function count(text, substring) {
  return text.split(substring).length - 1;
}
