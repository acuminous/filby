const fs = require('node:fs');
const path = require('node:path');

const Handlebars = require('handlebars');
const helpers = require('./helpers');

const hb = Handlebars.create();

const partialsDirectory = path.join(__dirname, 'partials');
const partials = fs.readdirSync(partialsDirectory)
  .filter(byHandlebarsTemplate)
  .reduce(toTemplateDictionary, {});

hb.registerHelper({ ...helpers, partial });
hb.registerPartial(partials);

function byHandlebarsTemplate(filename) {
  return /\.hbs$/.test(filename);
}

function toTemplateDictionary(dictionary, filename) {
  const { name } = path.parse(filename.replace(/-/g, '_'));
  const template = compile(partialsDirectory, filename);
  return {
    ...dictionary,
    [name]: template,
  };
}

function compile(directory, filename) {
  const fullPath = path.join(directory, filename);
  const source = fs.readFileSync(fullPath, 'utf-8');
  return hb.compile(source, { noEscape: false });
}

function partial(operation, options) {
  const { filename, directory } = options.data;
  const template = partials[operation.toLowerCase()];
  return new hb.SafeString(template(this, { data: { filename, directory } }));
}

function rejectUnescapedExpressions(expression) {
  if (typeof expression === 'string') throw new Error(`Unescaped expression '${expression}' in Handlebars template`);
  return expression;
}

function guard(template) {
  return (context, options) => {
    const original = Handlebars.Utils.escapeExpression;
    Handlebars.Utils.escapeExpression = rejectUnescapedExpressions;
    try {
      return template(context, options);
    } finally {
      Handlebars.Utils.escapeExpression = original;
    }
  };
}

module.exports = function compileTemplate(directory, template) {
  return guard(compile(directory, template));
};
