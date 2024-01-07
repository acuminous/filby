const fs = require('node:fs');
const Papa = require('papaparse');

function tableName(name, version) {
  return `${name.toLowerCase().replace(/\s/g, '_')}_v${version}`;
}

function loadCsv(path, options) {
  const rows = parseCsv(path);
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
  const { data } = Papa.parse(source, {
    header: true,
    dynamicTyping: true,
    skipEmptyLines: true,
    error: (err) => {
      throw err;
    },
  });
  return data;
}

function xkeys(obj, options) {
  return Object.keys(obj).reduce(toString.bind(options), '');
}

function xvalues(obj, options) {
  return Object.values(obj).reduce(toString.bind(options), '');
}

function and(...args) {
  return args.every(Boolean);
}

function toString(result, item, index, items) {
  const context = { item, isLast: index === items.length - 1 };
  return result + this.fn(context);
}

module.exports = {
  tableName,
  loadCsv,
  xkeys,
  xvalues,
  and,
};
