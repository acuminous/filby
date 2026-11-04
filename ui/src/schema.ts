import type { Document, Match, OpenApi, Operation, Parameter, Schema } from './types';

const RESERVED = ['changeSetId', 'page', 'pageSize'];

// field is the path of the property the parameter filters, absent when the documents do not carry it; nested marks a field inside a nest.
type FilterBase = { name: string; match: Match; field?: string[]; nested?: true };

export type Filter = (FilterBase & { kind: 'value'; values?: string[] }) | (FilterBase & { kind: 'list'; values?: string[] }) | (FilterBase & { kind: 'range'; from: string; to: string });

export type Column = { name: string; kind: 'value' | 'date-time' | 'array' | 'table' | 'lookup'; columns?: Column[]; on?: Record<string, string> };

export type Paging = { size?: number; max?: number };

export type ProjectionSchema = { operation: Operation; filters: Filter[]; columns: Column[] | undefined; paging: Paging | undefined };

export function describeProjection(document: OpenApi, name: string, version: number): ProjectionSchema | undefined {
  const operation = document.paths[`/projections/${encodeURIComponent(name)}/v${version}`]?.get;
  if (!operation) return undefined;
  const parameters = operation.parameters ?? [];
  const schema = operation.responses['200']?.content?.['application/json']?.schema;
  const described = schema?.items ? columns(schema.items) : undefined;
  return { operation, filters: filters(parameters, described), columns: described, paging: paging(parameters) };
}

export function filters(parameters: Parameter[], columns: Column[] = []): Filter[] {
  return parameters
    .filter(({ name }) => !RESERVED.includes(name))
    .flatMap((parameter): Filter[] => {
      const match = parameter['x-filby-match'] ?? 'equals';
      const field = parameter['x-filby-field'];
      const base = { match, ...(field && { field }), ...(field && throughNest(columns, field) && { nested: true as const }) };
      // Filby declares a range as <name>_from followed by <name>_to, both carrying the range match.
      if (match === 'range') {
        if (!parameter.name.endsWith('_from')) return [];
        const name = parameter.name.slice(0, -'_from'.length);
        return [{ kind: 'range', name, ...base, from: parameter.name, to: `${name}_to` }];
      }
      if (match === 'in') return [{ kind: 'list', name: parameter.name, ...base, ...values(parameter.schema.items) }];
      return [{ kind: 'value', name: parameter.name, ...base, ...values(parameter.schema) }];
    });
}

export function label(filter: Filter): string {
  const field = filter.field?.join('.');
  return field && field !== filter.name ? `${filter.match} ${field}` : filter.match;
}

function throughNest(columns: Column[], path: string[]): boolean {
  const [name, ...rest] = path;
  const column = columns.find((candidate) => candidate.name === name);
  if (!column || rest.length === 0) return false;
  return column.kind === 'table' || throughNest(column.columns ?? [], rest);
}

export function columns(schema: Schema): Column[] | undefined {
  if (!schema.properties) return undefined;
  return Object.entries(schema.properties).map(([name, property]) => {
    const type = baseType(property);
    if (type === 'array' && property.items?.properties) return { name, kind: 'table', columns: columns(property.items) };
    if (type === 'array') return { name, kind: 'array' };
    const object = objectSchema(property);
    if (object) return { name, kind: 'lookup', columns: columns(object), ...(property['x-filby-on'] && { on: property['x-filby-on'] }) };
    if (property.format === 'date-time') return { name, kind: 'date-time' };
    return { name, kind: 'value' };
  });
}

export function paging(parameters: Parameter[]): Paging | undefined {
  const pageSize = parameters.find(({ name }) => name === 'pageSize');
  if (!pageSize) return undefined;
  return { size: pageSize.schema.default, max: pageSize.schema.maximum };
}

export function inferColumns(documents: Document[]): Column[] {
  const names = [...new Set(documents.flatMap((document) => Object.keys(document)))];
  return names.map((name) => {
    const values = documents.map((document) => document[name]).filter((value) => value !== null && value !== undefined);
    const nested = values.filter(Array.isArray).flat();
    if (values.length > 0 && values.every(Array.isArray) && nested.length > 0 && nested.every((item) => typeof item === 'object' && item !== null)) {
      return { name, kind: 'table', columns: inferColumns(nested as Document[]) };
    }
    if (values.length > 0 && values.every(Array.isArray)) return { name, kind: 'array' };
    if (values.length > 0 && values.every(isPlainObject)) return { name, kind: 'lookup', columns: inferColumns(values as Document[]) };
    return { name, kind: 'value' };
  });
}

export function nests(columns: Column[], prefix = ''): string[] {
  return columns.filter(({ kind }) => kind === 'table').flatMap((column) => [`${prefix}${column.name}`, ...nests(column.columns ?? [], `${prefix}${column.name}.`)]);
}

export function lookups(columns: Column[], prefix = ''): string[] {
  return columns.flatMap((column) => {
    if (column.kind === 'lookup') return [`${prefix}${column.name}`];
    if (column.kind === 'table') return lookups(column.columns ?? [], `${prefix}${column.name}.`);
    return [];
  });
}

function isPlainObject(value: unknown): value is Document {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectSchema(schema: Schema): Schema | undefined {
  if (schema.properties) return schema;
  return schema.anyOf?.find((option) => option.properties);
}

function baseType(schema: Schema | undefined): string | undefined {
  if (!schema) return undefined;
  if (Array.isArray(schema.type)) return schema.type.find((type) => type !== 'null');
  if (schema.type) return schema.type;
  return schema.anyOf?.map(baseType).find((type) => type && type !== 'null');
}

function values(schema: Schema | undefined) {
  const found = schema?.enum ?? schema?.anyOf?.find((option) => option.enum)?.enum;
  return found ? { values: found } : {};
}
