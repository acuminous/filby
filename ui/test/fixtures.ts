import { vi } from 'vitest';

import type { ChangeSet, Document, OpenApi, Operation, Parameter, Projection, Schema } from '../src/types';

export type Stub = { status?: number; body?: unknown; headers?: Record<string, string> };
export type Routes = Record<string, Stub | ((url: URL) => Stub)>;

export function projection(overrides: Partial<Projection> = {}): Projection {
  return { name: 'Parks', version: 1, description: 'Holiday parks and their seasons', ...overrides };
}

export function changeSet(overrides: Partial<ChangeSet> = {}): ChangeSet {
  return { id: 1, effective: '2020-01-01T00:00:00.000Z', description: '2020 Parks', lastModified: '2019-12-01T10:30:00.000Z', entityTag: 'a1b2c3d4', ...overrides };
}

export function parameter(name: string, schema: Schema = { type: 'string' }, extra: Partial<Parameter> = {}): Parameter {
  return { name, in: 'query', schema, ...extra };
}

export const CHANGE_SET_ID = parameter('changeSetId', { type: 'integer' });
export const PAGE = parameter('page', { type: 'integer', minimum: 1 });
export const PAGE_SIZE = parameter('pageSize', { type: 'integer', minimum: 1, default: 2, maximum: 3 });

export const PARK_SCHEMA: Schema = {
  type: 'object',
  properties: {
    code: { type: 'string' },
    name: { type: ['string', 'null'] },
    seasons: {
      type: 'array',
      items: {
        type: 'object',
        properties: { type: { type: 'string', enum: ['Owners', 'Guests'] }, start: { type: 'string', format: 'date-time' }, end: { type: ['string', 'null'], format: 'date-time' } },
        required: ['type', 'start'],
        additionalProperties: false,
      },
    },
  },
  required: ['code', 'seasons'],
  additionalProperties: false,
};

export function operation(overrides: Partial<Operation> = {}): Operation {
  return {
    operationId: 'get_parks_v1',
    summary: 'Parks v1',
    description: 'Holiday parks and their seasons',
    parameters: [CHANGE_SET_ID, parameter('code'), PAGE, PAGE_SIZE],
    responses: { 200: { description: 'The documents', content: { 'application/json': { schema: { type: 'array', items: PARK_SCHEMA } } } } },
    ...overrides,
  };
}

export function openapi(operations: Record<string, Operation> = { '/projections/Parks/v1': operation() }): OpenApi {
  return { openapi: '3.1.0', paths: Object.fromEntries(Object.entries(operations).map(([path, get]) => [path, { get }])) };
}

export function park(overrides: Partial<Document> = {}): Document {
  return { code: 'DC', name: 'Devon Cliffs', seasons: [{ type: 'Guests', start: '2020-03-01T00:00:00.000Z', end: '2020-11-01T00:00:00.000Z' }], ...overrides };
}

export function stubApi(routes: Routes) {
  const requests: URL[] = [];
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = new URL(String(input), 'http://localhost');
    requests.push(url);
    const route = routes[url.pathname];
    if (!route) return new Response(JSON.stringify({ error: `No route for ${url.pathname}` }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    const { status = 200, body, headers = {} } = typeof route === 'function' ? route(url) : route;
    return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  });
  return requests;
}

export const DEEP_SCHEMA: Schema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    a: { type: 'array', items: { type: 'object', properties: { b: { type: 'array', items: { type: 'object', properties: { c: { type: 'integer' } } } } } } },
  },
};

export function deep(): Operation {
  return operation({ parameters: [CHANGE_SET_ID], responses: { 200: { description: 'Deep', content: { 'application/json': { schema: { type: 'array', items: DEEP_SCHEMA } } } } } });
}
