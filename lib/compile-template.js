const fs = require('fs');
const path = require('path');

const Handlebars = require('handlebars');
const helpers = require('./helpers');

const partialsDirectory = path.join(__dirname, 'partials');
const partials = fs.readdirSync(partialsDirectory)
  .filter(byHandlebarsTemplate)
  .reduce(toTemplateDictionary, {});

Handlebars.Utils.escapeExpression = rejectUnescapedExpressions;
Handlebars.registerHelper(helpers);
Handlebars.registerPartial(partials);

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
  return Handlebars.compile(source, { noEscape: false });
}

function rejectUnescapedExpressions(expression) {
  if (typeof expression === 'string') throw new Error(`Unescaped expression '${expression}' in Handlebars template`);
  return expression;
}

module.exports = function compileTemplate(directory, template) {
  return compile(directory, template);
};
