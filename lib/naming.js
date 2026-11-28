function canonicalise(...args) {
  return args.join(' ').toLowerCase().replace(/\s/g, '_');
}

function v(version) {
  return `v${version}`;
}

function table(name, version) {
  return canonicalise(name, v(version));
}

function aggregate(name, version) {
  return `get_${table(name, version)}_aggregate`;
}

function projectionFunction(name, version) {
  return `get_${table(name, version)}`;
}

function projectionArguments({ name, match }) {
  const canonical = canonicalise(name);
  if (match === 'range') return [{ name: `${canonical}_from`, array: false }, { name: `${canonical}_to`, array: false }];
  return [{ name: canonical, array: match === 'in' }];
}

export { canonicalise, v, table, aggregate, projectionFunction, projectionArguments };
