const fs = require('node:fs');
const Papa = require('papaparse');

function and(...args) {
  return args.every(Boolean);
}

function tableName(name, version) {
  return `${name.toLowerCase().replace(/\s/g, '_')}_v${version}`;
}

function loadCsv(path, options) {
  const { rows, errors } = parseCsv(path);
  if (errors[0]) throw new Error(`Error parsing ${path}:${errors[0].row + 2} - ${errors[0].message}`);
  const frames = rows.map((row) => {
    const data = Object.keys(row)
      .filter((key) => key !== 'action')
      .filter((key) => row[key] !== null)
      .reduce((obj, key) => {
        return { ...obj, [key]: row[key] };
      }, {});
    return { action: row.action, data };
  });

  return frames.reduce((output, frame) => {
    return output + options.fn(frame);
  }, '');
}

function parseCsv(path) {
  const source = fs.readFileSync(path, 'utf8');
  const { data: rows, errors } = Papa.parse(source, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
  });
  return { rows, errors };
}

function xkeys(obj, options) {
  return Object.keys(obj).reduce(toString.bind(options), '');
}

function xvalues(obj, options) {
  return Object.values(obj).reduce(toString.bind(options), '');
}

function toString(result, item, index, items) {
  const context = { item, isLast: index === items.length - 1 };
  return result + this.fn(context);
}

module.exports = {
  and,
  tableName,
  loadCsv,
  xkeys,
  xvalues,
};
