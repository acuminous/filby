module.exports = function (primary, secondary) {
  return new Proxy(primary, {
    get(obj, prop) {
      if (obj[prop] !== undefined) return obj[prop];
      else if (typeof secondary[prop] === 'function') {
        return function (...args) {
          return secondary[prop].apply(obj, args);
        };
      } else return undefined;
    }
  });
};