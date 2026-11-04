import { vi } from 'vitest';

import type { ChangeSet, Document, Match, OpenApi, Operation, Parameter, Projection, Schema } from '../src/types';

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

// A projection's declared parameter as Filby 1.0.0 describes it: its match, the field it filters when the document has one, and form style for a repeated parameter.
export function declared(name: string, match: Match, field?: string[], schema: Schema = { type: 'string' }): Parameter {
  return parameter(name, schema, { ...(schema.type === 'array' && { style: 'form', explode: true }), 'x-filby-match': match, ...(field && { 'x-filby-field': field }) });
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
    parameters: [CHANGE_SET_ID, declared('code', 'equals', ['code']), PAGE, PAGE_SIZE],
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

const AMENITY: Schema = { type: 'object', properties: { name: { type: 'string' }, category: { type: 'string', enum: ['Pool', 'Entertainment'] } }, required: ['name', 'category'], additionalProperties: false };

const BEACH: Schema = { type: 'object', properties: { code: { type: 'string' }, name: { type: 'string' }, surfaces: { type: 'array', items: { type: 'string', enum: ['Sandy', 'Rocky'] } }, surveyed: { type: 'string', format: 'date-time' } }, required: ['code', 'name', 'surfaces', 'surveyed'], additionalProperties: false };

export const DETAILED_SCHEMA: Schema = {
  type: 'object',
  properties: {
    code: { type: 'string' },
    name: { type: 'string' },
    amenities: {
      type: 'array',
      items: { type: 'object', properties: { amenity_code: { type: 'string' }, amenity: { anyOf: [AMENITY, { type: 'null' }], 'x-filby-on': { code: 'amenity_code' } } }, required: ['amenity_code', 'amenity'], additionalProperties: false },
      'x-filby-on': { park_code: 'code' },
    },
    beach_routes: {
      type: 'array',
      items: { type: 'object', properties: { name: { type: 'string' }, distance_metres: { type: 'integer' }, beach: { anyOf: [BEACH, { type: 'null' }], 'x-filby-on': { code: 'beach_code' } } }, required: ['name', 'distance_metres', 'beach'], additionalProperties: false },
      'x-filby-on': { park_code: 'code' },
    },
  },
  required: ['code', 'name', 'amenities', 'beach_routes'],
  additionalProperties: false,
};

export function detailed(): Operation {
  return operation({ operationId: 'get_parks_detailed_v1', summary: 'Parks (Detailed) v1', parameters: [CHANGE_SET_ID], responses: { 200: { description: 'The documents', content: { 'application/json': { schema: { type: 'array', items: DETAILED_SCHEMA } } } } } });
}

export function detailedPark(overrides: Partial<Document> = {}): Document {
  return {
    code: 'DC',
    name: 'Devon Cliffs',
    amenities: [
      { amenity_code: 'INDOOR_POOL', amenity: { name: 'Indoor Pool', category: 'Pool' } },
      { amenity_code: 'LIDO', amenity: null },
    ],
    beach_routes: [{ name: 'Cliff path', distance_metres: 400, beach: { code: 'SANDY_BAY', name: 'Sandy Bay', surfaces: ['Sandy', 'Rocky'], surveyed: '2020-03-01T00:00:00.000Z' } }],
    ...overrides,
  };
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

// Parks with the models they sell, as the holiday park example's Parks (Detailed) serves them from Filby 1.0.0. Each model is a link row that carries no fields of its own (fields: []),
// only the model lookup and a nest of offers, which joins on fields of the link row that the row does not carry.
export const LINK_ROW_SCHEMA: Schema = {
  type: 'object',
  properties: {
    code: { type: 'string' },
    models: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          offers: {
            type: 'array',
            items: { type: 'object', properties: { year: { type: 'integer' }, offer_price: { type: ['string', 'null'] } }, required: ['year'], additionalProperties: false },
            'x-filby-on': { park_code: 'park_code', model_code: 'model_code' },
          },
          model: { anyOf: [{ type: 'object', properties: { code: { type: 'string' }, name: { type: 'string' } }, required: ['code', 'name'], additionalProperties: false }, { type: 'null' }], 'x-filby-on': { code: 'model_code' } },
        },
        required: ['offers', 'model'],
        additionalProperties: false,
      },
      'x-filby-on': { park_code: 'code' },
    },
  },
  required: ['code', 'models'],
  additionalProperties: false,
};

export function linkRows(): Operation {
  return operation({ parameters: [CHANGE_SET_ID], responses: { 200: { description: 'The documents', content: { 'application/json': { schema: { type: 'array', items: LINK_ROW_SCHEMA } } } } } });
}

export function linkRowPark(overrides: Partial<Document> = {}): Document {
  return { code: 'DC', models: [{ offers: [{ year: 2026, offer_price: '19995.00' }], model: { code: 'CLW', name: 'Willerby Clearwater Lodge' } }], ...overrides };
}

const REGIONS: Schema = { type: 'string', enum: ['South West', 'Yorkshire', 'Wales'] };

// Parks as Filby 1.0.0 serves a projection that renames fields with { field, as }, whose amenities are link rows carrying no fields of their own (fields: []), only a lookup.
// Filby writes each alias into the property name, x-filby-on and x-filby-field, so park_code is Code, area is Region and amenity_ref and amenity_name are the amenity's Code and Name.
export const RENAMED_SCHEMA: Schema = {
  type: 'object',
  properties: {
    park_code: { type: 'string' },
    name: { type: 'string' },
    area: REGIONS,
    amenities: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          amenity: {
            anyOf: [{ type: 'object', properties: { amenity_ref: { type: 'string' }, amenity_name: { type: 'string' }, category: { type: 'string', enum: ['Pool', 'Entertainment'] } }, required: ['amenity_ref', 'amenity_name', 'category'], additionalProperties: false }, { type: 'null' }],
            'x-filby-on': { amenity_ref: 'amenity_code' },
          },
        },
        required: ['amenity'],
        additionalProperties: false,
      },
      'x-filby-on': { park_code: 'park_code' },
    },
  },
  required: ['park_code', 'name', 'area', 'amenities'],
  additionalProperties: false,
};

export function renamed(): Operation {
  return operation({
    operationId: 'get_parks_renamed_v1',
    summary: 'Parks (Renamed) v1',
    parameters: [CHANGE_SET_ID, declared('park_code', 'equals', ['park_code']), declared('area', 'in', ['area'], { type: 'array', items: REGIONS }), declared('amenity_name', 'prefix', ['amenities', 'amenity', 'amenity_name'])],
    responses: { 200: { description: 'The documents', content: { 'application/json': { schema: { type: 'array', items: RENAMED_SCHEMA } } } } },
  });
}

export function renamedPark(overrides: Partial<Document> = {}): Document {
  return {
    park_code: 'DC',
    name: 'Devon Cliffs',
    area: 'South West',
    amenities: [{ amenity: { amenity_ref: 'INDOOR_POOL', amenity_name: 'Indoor Pool', category: 'Pool' } }, { amenity: null }],
    ...overrides,
  };
}

// Park seasons as Filby 1.0.0 serves them with the park code renamed, joined to a park lookup on the renamed field, and a range parameter on a renamed date.
export const RENAMED_SEASON_SCHEMA: Schema = {
  type: 'object',
  properties: {
    park_ref: { type: 'string' },
    customer_type: { type: 'string', enum: ['Guest', 'Owner'] },
    opens: { type: 'string', format: 'date-time' },
    park: { anyOf: [{ type: 'object', properties: { code: { type: 'string' }, name: { type: 'string' } }, required: ['code', 'name'], additionalProperties: false }, { type: 'null' }], 'x-filby-on': { code: 'park_ref' } },
  },
  required: ['park_ref', 'customer_type', 'opens', 'park'],
  additionalProperties: false,
};

export function renamedSeasons(): Operation {
  const opens: Schema = { type: 'string', format: 'date-time' };
  return operation({
    operationId: 'get_seasons_renamed_v1',
    summary: 'Seasons (Renamed) v1',
    parameters: [CHANGE_SET_ID, declared('park_ref', 'equals', ['park_ref']), declared('opens_from', 'range', ['opens'], opens), declared('opens_to', 'range', ['opens'], opens)],
    responses: { 200: { description: 'The documents', content: { 'application/json': { schema: { type: 'array', items: RENAMED_SEASON_SCHEMA } } } } },
  });
}

export function renamedSeason(overrides: Partial<Document> = {}): Document {
  return { park_ref: 'DC', customer_type: 'Guest', opens: '2026-03-16T00:00:00.000Z', park: { code: 'DC', name: 'Devon Cliffs' }, ...overrides };
}

// Storage that throws on every access, as a browser's does when storage is disabled or full.
export function unavailableStorage() {
  vi.stubGlobal('localStorage', {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
  });
}

// happy-dom's document has no execCommand, so define one that records the command and the selected text box's value; test/setup.ts removes it after each test.
export function stubExecCommand(result = true) {
  const calls: { command: string; text: string | undefined }[] = [];
  const execCommand = (command: string) => {
    const active = document.activeElement;
    calls.push({ command, text: active instanceof HTMLTextAreaElement ? active.value.slice(active.selectionStart, active.selectionEnd) : undefined });
    return result;
  };
  Object.defineProperty(document, 'execCommand', { value: execCommand, configurable: true });
  return calls;
}

// happy-dom's navigator has no clipboard to spy on, so define one; test/setup.ts removes it after each test.
export function stubClipboard(writeText: (text: string) => Promise<void> = async () => {}) {
  const spy = vi.fn(writeText);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: spy }, configurable: true });
  return spy;
}
