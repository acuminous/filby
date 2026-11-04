import { describe, expect, it } from 'vitest';

import { columns, describeProjection, filters, inferColumns, label, paging } from '../src/schema';
import { CHANGE_SET_ID, DETAILED_SCHEMA, LINK_ROW_SCHEMA, PAGE, PAGE_SIZE, PARK_SCHEMA, RENAMED_SCHEMA, RENAMED_SEASON_SCHEMA, declared, detailedPark, openapi, operation, parameter, renamed, renamedSeasons } from './fixtures';

describe('filters', () => {
  it('ignores the reserved parameters', () => {
    expect(filters([CHANGE_SET_ID, PAGE, PAGE_SIZE])).toEqual([]);
  });

  it('ignores a parameter that carries no match', () => {
    expect(filters([parameter('code')])).toEqual([]);
  });

  it('describes a single value parameter with its match and field', () => {
    expect(filters([declared('code', 'equals', ['code'])])).toEqual([{ kind: 'value', name: 'code', match: 'equals', field: ['code'] }]);
  });

  it('describes each single value match', () => {
    const matches = ['equals', 'prefix', 'contains', 'gt', 'gte', 'lt', 'lte'] as const;
    expect(filters(matches.map((match) => declared(match, match, ['rate'])))).toEqual(matches.map((match) => ({ kind: 'value', name: match, match, field: ['rate'] })));
  });

  it('describes an in parameter as a list', () => {
    expect(filters([declared('types', 'in', ['type'], { type: 'array', items: { type: 'string' } })])).toEqual([{ kind: 'list', name: 'types', match: 'in', field: ['type'] }]);
  });

  it('describes a range parameter as one from and to pair', () => {
    expect(filters([declared('rate_from', 'range', ['rate']), declared('rate_to', 'range', ['rate']), declared('above', 'gt', ['rate'])])).toEqual([
      { kind: 'range', name: 'rate', match: 'range', field: ['rate'], from: 'rate_from', to: 'rate_to' },
      { kind: 'value', name: 'above', match: 'gt', field: ['rate'] },
    ]);
  });

  it('goes by the match, not the name', () => {
    expect(filters([declared('stay_from', 'gte', ['start']), declared('stay_to', 'lte', ['end']), declared('tags', 'contains', ['tags'])])).toEqual([
      { kind: 'value', name: 'stay_from', match: 'gte', field: ['start'] },
      { kind: 'value', name: 'stay_to', match: 'lte', field: ['end'] },
      { kind: 'value', name: 'tags', match: 'contains', field: ['tags'] },
    ]);
  });

  it('describes a parameter on a field the documents do not carry', () => {
    expect(filters([declared('region', 'equals')])).toStrictEqual([{ kind: 'value', name: 'region', match: 'equals' }]);
  });

  it('includes the enumerated values', () => {
    expect(filters([declared('type', 'equals', ['type'], { type: 'string', enum: ['Owners', 'Guests'] })])).toEqual([{ kind: 'value', name: 'type', match: 'equals', field: ['type'], values: ['Owners', 'Guests'] }]);
    expect(filters([declared('types', 'in', ['type'], { type: 'array', items: { type: 'string', enum: ['Owners', 'Guests'] } })])).toEqual([{ kind: 'list', name: 'types', match: 'in', field: ['type'], values: ['Owners', 'Guests'] }]);
  });

  it('marks a parameter whose field is inside a nest', () => {
    const parameters = [declared('code', 'equals', ['code']), declared('beach_surface', 'contains', ['beach_routes', 'beach', 'surfaces']), declared('amenity', 'equals', ['amenities', 'amenity_code'])];
    expect(filters(parameters, columns(DETAILED_SCHEMA)).map(({ name, nested }) => [name, nested])).toEqual([
      ['code', undefined],
      ['beach_surface', true],
      ['amenity', true],
    ]);
  });

  it('marks a parameter on a renamed field inside a lookup of a nest, by the alias Filby writes into x-filby-field', () => {
    expect(filters(renamed().parameters ?? [], columns(RENAMED_SCHEMA))).toEqual([
      { kind: 'value', name: 'park_code', match: 'equals', field: ['park_code'] },
      { kind: 'list', name: 'area', match: 'in', field: ['area'], values: ['South West', 'Yorkshire', 'Wales'] },
      { kind: 'value', name: 'amenity_name', match: 'prefix', field: ['amenities', 'amenity', 'amenity_name'], nested: true },
    ]);
  });

  it('pairs a range parameter on a renamed date', () => {
    expect(filters(renamedSeasons().parameters ?? [], columns(RENAMED_SEASON_SCHEMA))).toEqual([
      { kind: 'value', name: 'park_ref', match: 'equals', field: ['park_ref'] },
      { kind: 'range', name: 'opens', match: 'range', field: ['opens'], from: 'opens_from', to: 'opens_to' },
    ]);
  });

  it('does not mark a parameter whose field is on a lookup at the root', () => {
    const schema = { type: 'object', properties: { code: { type: 'string' }, region: { type: 'object', properties: { name: { type: 'string' } } } } };
    expect(filters([declared('region', 'equals', ['region', 'name'])], columns(schema))[0]?.nested).toBeUndefined();
  });
});

describe('label', () => {
  it('names the match', () => {
    expect(label({ kind: 'value', name: 'code', match: 'equals', field: ['code'] })).toBe('equals');
    expect(label({ kind: 'range', name: 'rate', match: 'range', field: ['rate'], from: 'rate_from', to: 'rate_to' })).toBe('range');
  });

  it('names the field when it differs from the parameter', () => {
    expect(label({ kind: 'value', name: 'above', match: 'gt', field: ['rate'] })).toBe('gt rate');
    expect(label({ kind: 'value', name: 'beach_surface', match: 'contains', field: ['beach_routes', 'beach', 'surfaces'] })).toBe('contains beach_routes.beach.surfaces');
  });

  it('names only the match when there is no field', () => {
    expect(label({ kind: 'value', name: 'region', match: 'equals' })).toBe('equals');
  });
});

describe('columns', () => {
  it('derives the columns from the document schema, nesting to any depth', () => {
    expect(columns(PARK_SCHEMA)).toEqual([
      { name: 'code', kind: 'value' },
      { name: 'name', kind: 'value' },
      { name: 'seasons', kind: 'table', columns: [{ name: 'type', kind: 'value' }, { name: 'start', kind: 'date-time' }, { name: 'end', kind: 'date-time' }] },
    ]);
  });

  it('nests deeper', () => {
    const schema = { type: 'object', properties: { a: { type: 'array', items: { type: 'object', properties: { b: { type: 'array', items: { type: 'object', properties: { c: { type: 'integer' } } } } } } } } };
    expect(columns(schema)).toEqual([{ name: 'a', kind: 'table', columns: [{ name: 'b', kind: 'table', columns: [{ name: 'c', kind: 'value' }] }] }]);
  });

  it('treats an array of scalars as a value array', () => {
    expect(columns({ type: 'object', properties: { tags: { type: ['array', 'null'], items: { type: 'string' } } } })).toEqual([{ name: 'tags', kind: 'array' }]);
  });

  it('handles a nullable enum expressed with anyOf', () => {
    expect(columns({ type: 'object', properties: { type: { anyOf: [{ type: 'string', enum: ['a'] }, { type: 'null' }] } } })).toEqual([{ name: 'type', kind: 'value' }]);
  });

  it('treats a nullable object as a lookup with its own columns', () => {
    expect(columns(DETAILED_SCHEMA)).toEqual([
      { name: 'code', kind: 'value' },
      { name: 'name', kind: 'value' },
      { name: 'amenities', kind: 'table', columns: [{ name: 'amenity_code', kind: 'value' }, { name: 'amenity', kind: 'lookup', columns: [{ name: 'name', kind: 'value' }, { name: 'category', kind: 'value' }], on: { code: 'amenity_code' } }] },
      { name: 'beach_routes', kind: 'table', columns: [{ name: 'name', kind: 'value' }, { name: 'distance_metres', kind: 'value' }, { name: 'beach', kind: 'lookup', columns: [{ name: 'code', kind: 'value' }, { name: 'name', kind: 'value' }, { name: 'surfaces', kind: 'array' }, { name: 'surveyed', kind: 'date-time' }], on: { code: 'beach_code' } }] },
    ]);
  });

  it('describes a link row that carries no fields of its own, only a lookup and a nest', () => {
    expect(columns(LINK_ROW_SCHEMA)).toEqual([
      { name: 'code', kind: 'value' },
      {
        name: 'models',
        kind: 'table',
        columns: [
          { name: 'offers', kind: 'table', columns: [{ name: 'year', kind: 'value' }, { name: 'offer_price', kind: 'value' }] },
          { name: 'model', kind: 'lookup', columns: [{ name: 'code', kind: 'value' }, { name: 'name', kind: 'value' }], on: { code: 'model_code' } },
        ],
      },
    ]);
  });

  it('names renamed fields by their aliases, with a link row that carries only its lookup', () => {
    expect(columns(RENAMED_SCHEMA)).toEqual([
      { name: 'park_code', kind: 'value' },
      { name: 'name', kind: 'value' },
      { name: 'area', kind: 'value' },
      { name: 'amenities', kind: 'table', columns: [{ name: 'amenity', kind: 'lookup', columns: [{ name: 'amenity_ref', kind: 'value' }, { name: 'amenity_name', kind: 'value' }, { name: 'category', kind: 'value' }], on: { amenity_ref: 'amenity_code' } }] },
    ]);
  });

  it('joins a lookup at the root on a renamed field', () => {
    expect(columns(RENAMED_SEASON_SCHEMA)?.at(-1)).toEqual({ name: 'park', kind: 'lookup', columns: [{ name: 'code', kind: 'value' }, { name: 'name', kind: 'value' }], on: { code: 'park_ref' } });
  });

  it('carries no join fields on a lookup without the extension', () => {
    expect(columns({ type: 'object', properties: { amenity: { anyOf: [{ type: 'object', properties: { name: { type: 'string' } } }, { type: 'null' }] } } })).toStrictEqual([{ name: 'amenity', kind: 'lookup', columns: [{ name: 'name', kind: 'value' }] }]);
  });

  it('treats an object at the root as a lookup', () => {
    expect(columns({ type: 'object', properties: { code: { type: 'string' }, region: { type: 'object', properties: { name: { type: 'string' } } } } })).toEqual([
      { name: 'code', kind: 'value' },
      { name: 'region', kind: 'lookup', columns: [{ name: 'name', kind: 'value' }] },
    ]);
  });

  it('returns nothing for an unconstrained schema', () => {
    expect(columns({ type: 'object' })).toBeUndefined();
  });
});

describe('inferColumns', () => {
  it('infers nested arrays, value arrays and lookups from the documents', () => {
    expect(inferColumns([detailedPark(), detailedPark({ code: 'PV', amenities: [], beach_routes: [{ name: 'None', distance_metres: 0, beach: null }] })])).toStrictEqual([
      { name: 'code', kind: 'value' },
      { name: 'name', kind: 'value' },
      { name: 'amenities', kind: 'table', columns: [{ name: 'amenity_code', kind: 'value' }, { name: 'amenity', kind: 'lookup', columns: [{ name: 'name', kind: 'value' }, { name: 'category', kind: 'value' }] }] },
      { name: 'beach_routes', kind: 'table', columns: [{ name: 'name', kind: 'value' }, { name: 'distance_metres', kind: 'value' }, { name: 'beach', kind: 'lookup', columns: [{ name: 'code', kind: 'value' }, { name: 'name', kind: 'value' }, { name: 'surfaces', kind: 'array' }, { name: 'surveyed', kind: 'value' }] }] },
    ]);
  });

  it('keeps a property that is sometimes an object as a value', () => {
    expect(inferColumns([{ a: { b: 1 } }, { a: 2 }, { a: null }])).toEqual([{ name: 'a', kind: 'value' }]);
  });

  it('keeps a property that is always null as a value', () => {
    expect(inferColumns([{ a: null }])).toEqual([{ name: 'a', kind: 'value' }]);
  });
});

describe('paging', () => {
  it('reads the page size and maximum', () => {
    expect(paging([PAGE, PAGE_SIZE])).toEqual({ size: 2, max: 3 });
  });

  it('reads an unbounded page size', () => {
    expect(paging([PAGE, parameter('pageSize', { type: 'integer', minimum: 1 })])).toEqual({ size: undefined, max: undefined });
  });

  it('is absent without paging parameters', () => {
    expect(paging([CHANGE_SET_ID, parameter('code')])).toBeUndefined();
  });
});

describe('describeProjection', () => {
  it('finds the projection by its encoded path', () => {
    const document = openapi({ '/projections/VAT%20Rates/v2': operation({ summary: 'VAT Rates v2' }) });
    expect(describeProjection(document, 'VAT Rates', 2)?.operation.summary).toBe('VAT Rates v2');
    expect(describeProjection(document, 'VAT Rates', 1)).toBeUndefined();
  });

  it('describes the filters, columns and paging', () => {
    const description = describeProjection(openapi(), 'Parks', 1);
    expect(description?.filters).toEqual([{ kind: 'value', name: 'code', match: 'equals', field: ['code'] }]);
    expect(description?.columns?.map(({ name }) => name)).toEqual(['code', 'name', 'seasons']);
    expect(description?.paging).toEqual({ size: 2, max: 3 });
  });

  it('describes a projection served from a function', () => {
    const get = operation({ parameters: [CHANGE_SET_ID, PAGE, parameter('pageSize', { type: 'integer', minimum: 1 })], responses: { 200: { description: 'Rows', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } } });
    const description = describeProjection(openapi({ '/projections/Parks/v1': get }), 'Parks', 1);
    expect(description?.filters).toEqual([]);
    expect(description?.columns).toBeUndefined();
    expect(description?.paging).toEqual({ size: undefined, max: undefined });
  });
});
