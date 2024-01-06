module.exports = {
  xkeys: (obj, options) => Object.keys(obj).reduce(toString.bind(options), ''),
  xvalues: (obj, options) => Object.values(obj).reduce(toString.bind(options), ''),
  eq: (a, b) => a === b,
  ne: (a, b) => a !== b,
  lt: (a, b) => a < b,
  gt: (a, b) => a > b,
  lte: (a, b) => a <= b,
  gte: (a, b) => a >= b,
  and() {
    return Array.prototype.every.call(arguments, Boolean);
  },
  or() {
    return Array.prototype.slice.call(arguments, 0, -1).some(Boolean);
  }
}

function toString(result, item, index, items) {
  const context = { item, 'isLast': index === items.length - 1 };
  return result + this.fn(context)
}
