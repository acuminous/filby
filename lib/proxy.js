module.exports = function createProxy(primary, secondary) {
  return new Proxy(primary, {
    get(obj, prop) {
      if (obj[prop] !== undefined) return obj[prop];
      if (typeof secondary[prop] === 'function') {
        return function delegate(...args) {
          return secondary[prop].apply(obj, args);
        };
      }
    },
  });
};
