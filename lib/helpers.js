module.exports = {
  tableName: (name, version) => `${name.toLowerCase().replace(/\s/g, '_')}_v${version}`,
  xkeys: (obj, options) => Object.keys(obj).reduce(toString.bind(options), ''),
  xvalues: (obj, options) => Object.values(obj).reduce(toString.bind(options), ''),
  and() {
    return Array.prototype.every.call(arguments, Boolean);
  }
}

function toString(result, item, index, items) {
  const context = { item, 'isLast': index === items.length - 1 };
  return result + this.fn(context)
}
