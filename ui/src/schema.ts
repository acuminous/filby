import type { Document, OpenApi, Operation, Parameter, Schema } from './types';

const RESERVED = ['changeSetId', 'page', 'pageSize'];

export type Filter = { kind: 'value'; name: string; values?: string[] } | { kind: 'list'; name: string; values?: string[] } | { kind: 'range'; name: string; from: string; to: string };

export type Column = { name: string; kind: 'value' | 'date-time' | 'array' | 'table' | 'lookup'; columns?: Column[] };

export type Paging = { size?: number; max?: number };

export type ProjectionSchema = { operation: Operation; filters: Filter[]; columns: Column[] | undefined; paging: Paging | undefined };

export function describeProjection(document: OpenApi, name: string, version: number): ProjectionSchema | undefined {
  const operation = document.paths[`/projections/${encodeURIComponent(name)}/v${version}`]?.get;
  if (!operation) return undefined;
  const parameters = operation.parameters ?? [];
  const schema = operation.responses['200']?.content?.['application/json']?.schema;
  return { operation, filters: filters(parameters), columns: schema?.items ? columns(schema.items) : undefined, paging: paging(parameters) };
}

export function filters(parameters: Parameter[]): Filter[] {
  const declared = parameters.filter(({ name }) => !RESERVED.includes(name));
  const result: Filter[] = [];
  for (let i = 0; i < declared.length; i++) {
    const parameter = declared[i] as Parameter;
    const next = declared[i + 1];
    if (parameter.name.endsWith('_from') && next?.name === `${parameter.name.slice(0, -5)}_to`) {
      result.push({ kind: 'range', name: parameter.name.slice(0, -5), from: parameter.name, to: next.name });
      i++;
    } else if (baseType(parameter.schema) === 'array') {
      result.push({ kind: 'list', name: parameter.name, ...values(parameter.schema.items) });
    } else {
      result.push({ kind: 'value', name: parameter.name, ...values(parameter.schema) });
    }
  }
  return result;
}

export function columns(schema: Schema): Column[] | undefined {
  if (!schema.properties) return undefined;
  return Object.entries(schema.properties).map(([name, property]) => {
    const type = baseType(property);
    if (type === 'array' && property.items?.properties) return { name, kind: 'table', columns: columns(property.items) };
    if (type === 'array') return { name, kind: 'array' };
    const object = objectSchema(property);
    if (object) return { name, kind: 'lookup', columns: columns(object) };
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
