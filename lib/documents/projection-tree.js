import { sql } from '../database/sql.js';

async function loadProjections(tx, projectionId = null) {
  const { rows: projections } = await tx.query(sql.tree.listProjections, [projectionId]);
  const { rows: dependencies } = await tx.query(sql.tree.listDependencies, [projectionId]);
  const { rows: parameters } = await tx.query(sql.tree.listParameters, [projectionId]);
  const { rows: order } = await tx.query(sql.tree.listOrder, [projectionId]);
  const { rows: nests } = await tx.query(sql.tree.listNests, [projectionId]);
  const { rows: on } = await tx.query(sql.tree.listNestJoins, [projectionId]);
  const { rows: nestOrder } = await tx.query(sql.tree.listNestOrder, [projectionId]);
  const { rows: fields } = await tx.query(sql.tree.listFields);
  const nestTree = (ownerId, parentNestId) => nests
    .filter(({ projection_id, parent_nest_id }) => projection_id === ownerId && parent_nest_id === parentNestId)
    .map((nest) => ({
      ...nest,
      on: on.filter(({ nest_id }) => nest_id === nest.id),
      order: nestOrder.filter(({ nest_id }) => nest_id === nest.id),
      fields: fields.filter(({ entity_id }) => entity_id === nest.entity_id),
      nests: nestTree(ownerId, nest.id),
    }));
  return projections.map((projection) => ({
    ...projection,
    dependencies: dependencies.filter(({ projection_id }) => projection_id === projection.id),
    fields: fields.filter(({ entity_id }) => entity_id === projection.root_entity_id),
    parameters: parameters.filter(({ projection_id }) => projection_id === projection.id),
    order: order.filter(({ projection_id }) => projection_id === projection.id),
    nests: nestTree(projection.id, null),
  }));
}

function documentPath(projection, field) {
  const segments = field.split('.');
  const name = segments.pop();
  const container = segments.reduce(({ nests }, segment) => nests.find((nest) => nest.name === segment), projection);
  const property = carriedName(container, name);
  if (property !== undefined) return { container, name, path: [...segments, property], carried: true };
  const lookup = joiningLookup(container, name);
  if (lookup) return { container, name, path: [...segments, ...lookup], carried: true };
  return { container, name, path: [...segments, name], carried: false };
}

function joiningLookup({ nests }, name) {
  for (const nest of nests.filter(({ lookup }) => lookup)) {
    const join = nest.on.find(({ parent_field }) => parent_field === name);
    const property = join && carriedName(nest, join.field);
    if (property !== undefined) return [nest.name, property];
  }
}

function carriedName({ selection, aliases, on = [] }, name) {
  if (!selection) return on.some(({ field }) => field === name) ? undefined : name;
  return selection.includes(name) ? propertyName({ selection, aliases }, name) : undefined;
}

function propertyName({ selection, aliases }, name) {
  const carried = aliases?.filter((_, index) => selection[index] === name) ?? [];
  return carried.length === 0 || carried.includes(name) ? name : carried[0];
}

export { loadProjections, documentPath, propertyName };
