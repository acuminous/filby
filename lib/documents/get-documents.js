import { escapeIdentifier } from 'pg';

import { canonicalise, aggregate, projectionFunction, projectionArguments } from '../naming.js';
import { MissingFunctionError } from '../errors.js';

export async function getDocuments(tx, projection, changeSetId, { parameters = {}, pageOffset, pageSize } = {}) {
  const { rows: [declaration] } = await tx.query('SELECT id, root_entity_id, aliases, fields_since, page_size, page_max FROM fby_projection WHERE name = $1 AND version = $2 AND dropped_at IS NULL', [projection.name, projection.version]);
  if (!declaration) throw new Error(`Projection '${projection.key}' does not exist`);

  const { rows: declaredParameters } = await tx.query('SELECT name, match FROM fby_projection_parameter WHERE projection_id = $1 ORDER BY position', [declaration.id]);
  const names = declaredParameters.flatMap(projectionArguments).map(({ name }) => name);
  const unknown = Object.keys(parameters).find((name) => !names.includes(name));
  if (unknown) throw new Error(`Projection '${projection.key}' has no parameter '${unknown}'${parameterHint(names)}`);
  if (!declaration.root_entity_id) return getRows(tx, projection, changeSetId, pageOffset ?? 0, declaration.page_size ? Math.min(pageSize ?? declaration.page_size, declaration.page_max) : pageSize ?? null);

  const values = [changeSetId, ...names.map((name) => parameters[name] ?? null), pageOffset ?? 0, pageSize ?? declaration.page_size ?? null];
  const root = `${escapeIdentifier(projectionFunction(projection.name, projection.version))}(${['change_set_id', ...names, 'page_offset', 'page_size'].map((name, index) => `${escapeIdentifier(`p_${name}`)} => $${index + 1}`).join(', ')})`;

  const query = async (offset, size) => (await tx.query(`SELECT * FROM ${root}`, [...values.slice(0, -2), offset, size])).rows;
  const { documents, total } = await queryPage(query, values.at(-2), values.at(-1));

  const known = await knownFields(tx, changeSetId);
  const { rows: declared } = await tx.query('SELECT n.id, n.parent_nest_id, n.name, n.entity_id, n.lookup, n.fields, n.aliases, n.fields_since, e.name AS entity, e.version FROM fby_projection_nest n INNER JOIN fby_entity e ON e.id = n.entity_id WHERE n.projection_id = $1 AND (n.since IS NULL OR n.since <= $2) ORDER BY n.position', [declaration.id, changeSetId]);
  const nests = [];
  for (const nest of declared) {
    const { rows: on } = await tx.query('SELECT field, parent_field FROM fby_projection_nest_on WHERE nest_id = $1 ORDER BY position', [nest.id]);
    const { rows: order } = await tx.query('SELECT field, direction, nulls FROM fby_projection_nest_order WHERE nest_id = $1 ORDER BY position', [nest.id]);
    const { rows: key } = await tx.query('SELECT name AS field FROM fby_entity_field WHERE entity_id = $1 AND identity ORDER BY position', [nest.entity_id]);
    nests.push({ ...nest, fields: selection(nest, changeSetId), known: known(nest.entity_id), on, order: [...order, ...key.map(({ field }) => ({ field, direction: 'ASC' }))], source: `${escapeIdentifier(aggregate(nest.entity, nest.version))}($1)` });
  }

  const childNames = (parentNestId) => nests.filter((candidate) => candidate.parent_nest_id === parentNestId).map(({ name }) => name);
  const attachNests = async (parents, parentNestId, lineage) => {
    for (const nest of nests.filter((candidate) => candidate.parent_nest_id === parentNestId)) {
      const alias = `c${lineage.length}`;
      const { rows: children } = await tx.query(`SELECT ${alias}.* FROM ${nest.source} ${alias} WHERE ${semiJoin(lineage, alias, nest.on)} ORDER BY ${nestOrder(alias, nest.order)}`, values);
      if (!nest.lookup) await attachNests(children, nest.id, [{ source: nest.source, alias, on: nest.on }, ...lineage]);
      attachChildren(parents, nest, children, childNames(nest.id));
    }
  };
  await attachNests(documents, null, [{ source: root, alias: 'a' }]);

  const fields = selection({ fields: declaration.aliases, aliases: declaration.aliases, fields_since: declaration.fields_since }, changeSetId);
  return { documents: documents.map((document) => select(document, { fields, on: [], known: known(declaration.root_entity_id) }, childNames(null))), total };
}

async function getRows(tx, projection, changeSetId, pageOffset, pageSize) {
  const functionName = projectionFunction(projection.name, projection.version);
  const { rowCount: functionExists } = await tx.query('SELECT 1 FROM pg_proc WHERE proname = $1', [functionName]);
  if (!functionExists) throw new MissingFunctionError(`Function '${functionName}' does not exist`);
  const query = async (offset, size) => (await tx.query(`SELECT *, COUNT(*) OVER () AS fby_total FROM ${escapeIdentifier(functionName)}($1) LIMIT $2 OFFSET $3`, [changeSetId, size, offset])).rows;
  return queryPage(query, pageOffset, pageSize);
}

function parameterHint(names) {
  return names.length ? `; existing parameters are ${names.map((name) => `'${name}'`).join(', ')}` : '';
}

function semiJoin([parent, ...ancestors], alias, on) {
  const nested = ancestors.length ? ` AND ${semiJoin(ancestors, parent.alias, parent.on)}` : '';
  return `EXISTS (SELECT 1 FROM ${parent.source} ${parent.alias} WHERE ${nestPredicates(alias, parent.alias, on)}${nested})`;
}

function attachChildren(parents, { name, on, lookup, fields, known }, children, childNames) {
  const index = new Map();
  for (const parent of parents) {
    parent[name] = lookup ? null : [];
    const key = JSON.stringify(on.map(({ parent_field }) => parent[parent_field]));
    index.set(key, [...(index.get(key) ?? []), parent]);
  }
  for (const child of children) {
    const key = JSON.stringify(on.map(({ field }) => child[field]));
    const document = select(child, { fields, on, known }, childNames);
    for (const parent of index.get(key) ?? []) {
      if (lookup) parent[name] = document;
      else parent[name].push(document);
    }
  }
}

function selection({ fields, aliases, fields_since }, changeSetId) {
  return fields?.map((field, index) => ({ field, as: aliases[index], since: fields_since?.[index] ?? null })).filter(({ since }) => since === null || since <= changeSetId);
}

function select(row, { fields, on, known }, childNames) {
  const names = fields ? childNames : [...known.filter((field) => !on.some((join) => join.field === field)), ...childNames];
  return Object.fromEntries([...(fields ?? []).map(({ field, as }) => [as, row[field]]), ...names.map((name) => [name, row[name]])]);
}

async function knownFields(tx, changeSetId) {
  const { rows } = await tx.query('SELECT entity_id, name FROM fby_entity_field WHERE since IS NULL OR since <= $1 ORDER BY entity_id, position', [changeSetId]);
  return (entityId) => rows.filter(({ entity_id }) => entity_id === entityId).map(({ name }) => name);
}

async function queryPage(query, offset, size) {
  const rows = await query(offset, size);
  const [first] = rows.length === 0 && offset > 0 ? await query(0, 1) : rows;
  return { documents: rows.map(({ fby_total, ...document }) => document), total: Number(first?.fby_total ?? 0) };
}

function nestOrder(alias, order) {
  return order.map(({ field, direction, nulls }) => `${alias}.${escapeIdentifier(canonicalise(field))} ${direction}${nulls ? ` NULLS ${nulls}` : ''}`).join(', ');
}

function nestPredicates(alias, parentAlias, on) {
  return on.map(({ field, parent_field }) => `${alias}.${escapeIdentifier(canonicalise(field))} = ${parentAlias}.${escapeIdentifier(canonicalise(parent_field))}`).join(' AND ');
}
