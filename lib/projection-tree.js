async function loadProjections(tx, projectionId = null) {
  const { rows: projections } = await tx.query(`
    SELECT p.id, p.name, p.version, p.description, p.root_entity_id, e.name AS root_name, e.version AS root_version, p.fields AS selection, p.aliases, p.fields_since, p.page_size, p.page_max
    FROM fby_projection p
    LEFT JOIN fby_entity e ON e.id = p.root_entity_id
    WHERE p.dropped_at IS NULL AND ($1::INTEGER IS NULL OR p.id = $1)
    ORDER BY p.name, p.version`, [projectionId]);
  const { rows: dependencies } = await tx.query(`
    SELECT pe.projection_id, e.name, e.version
    FROM fby_projection_entity pe
    INNER JOIN fby_entity e ON e.id = pe.entity_id
    WHERE $1::INTEGER IS NULL OR pe.projection_id = $1
    ORDER BY e.name, e.version`, [projectionId]);
  const { rows: parameters } = await tx.query('SELECT projection_id, name, field, match, since FROM fby_projection_parameter WHERE $1::INTEGER IS NULL OR projection_id = $1 ORDER BY projection_id, position', [projectionId]);
  const { rows: order } = await tx.query('SELECT projection_id, field, direction, nulls FROM fby_projection_order WHERE $1::INTEGER IS NULL OR projection_id = $1 ORDER BY projection_id, position', [projectionId]);
  const { rows: nests } = await tx.query(`
    SELECT n.id, n.projection_id, n.parent_nest_id, n.name, n.entity_id, e.name AS entity_name, e.version AS entity_version, n.lookup, n.fields AS selection, n.aliases, n.fields_since, n.since
    FROM fby_projection_nest n
    INNER JOIN fby_entity e ON e.id = n.entity_id
    WHERE $1::INTEGER IS NULL OR n.projection_id = $1
    ORDER BY n.projection_id, n.position`, [projectionId]);
  const { rows: on } = await tx.query('SELECT o.nest_id, o.field, o.parent_field FROM fby_projection_nest_on o INNER JOIN fby_projection_nest n ON n.id = o.nest_id WHERE $1::INTEGER IS NULL OR n.projection_id = $1 ORDER BY o.nest_id, o.position', [projectionId]);
  const { rows: nestOrder } = await tx.query('SELECT o.nest_id, o.field, o.direction, o.nulls FROM fby_projection_nest_order o INNER JOIN fby_projection_nest n ON n.id = o.nest_id WHERE $1::INTEGER IS NULL OR n.projection_id = $1 ORDER BY o.nest_id, o.position', [projectionId]);
  const { rows: fields } = await tx.query('SELECT entity_id, name, type, nullable, since FROM fby_entity_field ORDER BY entity_id, position');
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
