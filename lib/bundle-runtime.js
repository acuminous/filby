module.exports = function runtime(bundle) {
  const key = `${bundle.name} v${bundle.version}`;
  const changeSets = bundle.changeSets.map((changeSet) => ({ ...changeSet, effective: new Date(changeSet.effective), lastModified: new Date(changeSet.lastModified) }));

  function asOf(instant) {
    const time = new Date(instant).getTime();
    if (Number.isNaN(time)) throw new TypeError(`Invalid instant '${instant}'`);
    return changeSets.filter(({ effective }) => effective.getTime() <= time).sort((a, b) => b.effective - a.effective || b.id - a.id)[0];
  }

  function getDocuments(changeSetId) {
    if (!Object.hasOwn(bundle.documents, changeSetId)) throw new Error(`Change set ${changeSetId} does not exist`);
    return bundle.documents[changeSetId].map((document) => revive(document, bundle.schema));
  }

  function getCurrentDocuments(instant = new Date()) {
    const changeSet = asOf(instant);
    if (!changeSet) throw new Error(`Projection '${key}' has no change set in force at ${new Date(instant).toISOString()}`);
    return getDocuments(changeSet.id);
  }

  return { name: bundle.name, version: bundle.version, description: bundle.description, changeSets, asOf, getDocuments, getCurrentDocuments };
};

function revive(value, schema = {}) {
  if (value === null || value === undefined) return value;
  if (schema.anyOf) return revive(value, schema.anyOf.find((option) => option.type !== 'null'));
  if (schema.format === 'date-time' && typeof value === 'string') return new Date(value);
  if (Array.isArray(value)) return value.map((item) => revive(item, schema.items));
  if (typeof value === 'object') return schema.properties ? Object.fromEntries(Object.entries(value).map(([name, item]) => [name, revive(item, schema.properties[name])])) : structuredClone(value);
  return value;
}
