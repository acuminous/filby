const fs = require('fs');
const Papa = require('papaparse');

module.exports = {
  tableName: (name, version) => `${name.toLowerCase().replace(/\s/g, '_')}_v${version}`,
  /* eslint-disable no-param-reassign */
  loadCsv: (path, options) => {
    const source = fs.readFileSync(path, 'utf8');
    let frames;
    Papa.parse(source, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => {
        frames = results.data.map((data) => {
          const action = data.action;
          delete data.action;
          Object.keys(data).forEach((key) => {
            if (data[key] === null) delete data[key];
          });
          return { action, data };
        });
      },
      error: (err) => {
        throw err;
      },
    });
    return frames.reduce((output, frame) => {
      return output + options.fn(frame);
    }, '');
  },
  /* eslint-enable no-param-reassign */
  xkeys: (obj, options) => Object.keys(obj).reduce(toString.bind(options), ''),
  xvalues: (obj, options) => Object.values(obj).reduce(toString.bind(options), ''),
  and(...args) {
    return args.every(Boolean);
  },
};

function toString(result, item, index, items) {
  const context = { item, isLast: index === items.length - 1 };
  return result + this.fn(context);
}
