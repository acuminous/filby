import fs from 'node:fs';
import path from 'node:path';
import { strictEqual as eq, deepEqual as deq } from 'node:assert';
import { describe, it, before, beforeEach, after } from 'node:test';
import YAML from 'yaml';
import op from 'object-path-immutable';
import { Validator } from '@seriousme/openapi-schema-validator';
import Ajv from 'ajv/dist/2020.js';

import TestFilby from './TestFilby.js';

const config = {
  nukeCustomObjects: async (tx) => {
    await tx.query('DROP FUNCTION IF EXISTS get_vat_rates_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_parks_v1');
    await tx.query('DROP TABLE IF EXISTS park_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_park_v1_aggregate');
    await tx.query('DROP TABLE IF EXISTS season_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_season_v1_aggregate');
    await tx.query('DROP TABLE IF EXISTS rate_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_rate_v1_aggregate');
    await tx.query('DROP TABLE IF EXISTS vat_rate_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_vat_rate_v1_aggregate');
    await tx.query('DROP FUNCTION IF EXISTS get_parks_v2');
    await tx.query('DROP FUNCTION IF EXISTS get_seasons_v1');
    await tx.query('DROP TABLE IF EXISTS park_v2');
    await tx.query('DROP FUNCTION IF EXISTS get_park_v2_aggregate');
    await tx.query('DROP TABLE IF EXISTS park_season_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_park_season_v1_aggregate');
    await tx.query('DROP TYPE IF EXISTS customer_type');
    await tx.query('DROP TYPE IF EXISTS amenity_category');
  },
};

const ADD_ENTITY = loadYaml('ADD_ENTITY');
const ADD_PROJECTION = loadYaml('ADD_PROJECTION');
const ADD_ROOT_PROJECTION = loadYaml('ADD_ROOT_PROJECTION');
const ADD_PARK_ENTITIES = loadYaml('ADD_PARK_ENTITIES');
const ADD_NESTED_PROJECTION = loadYaml('ADD_NESTED_PROJECTION');
const DROP_PROJECTION = loadYaml('DROP_PROJECTION');
const DROP_ENTITY = loadYaml('DROP_ENTITY');

describe('Declarations', () => {

  let filby;

  before(async () => {
    filby = new TestFilby(config);
    await filby.reset();
  });

  beforeEach(async () => {
    await filby.wipe();
  });

  after(async () => {
    await filby.stop();
  });

  describe('Routing', () => {

    it('should respond with 404 for an unknown path', async () => {
      const response = await get('/wombats');
      eq(response.status, 404);
      deq(await response.json(), { error: 'No route for /wombats' });
    });

    it('should respond with 405 for a method other than GET or HEAD on a known path', async () => {
      const response = await filby.fetchDeclarations(new Request('http://localhost/projections', { method: 'POST' }));
      eq(response.status, 405);
      eq(response.headers.get('Allow'), 'GET, HEAD');
      deq(await response.json(), { error: 'Method POST is not allowed' });
    });

    it('should respond to HEAD requests with the status and headers of GET and no body', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION);
      const expected = await get('/projections/VAT%20Rates/v1');

      const response = await filby.fetchDeclarations(new Request('http://localhost/projections/VAT%20Rates/v1', { method: 'HEAD' }));
      eq(response.status, 200);
      deq([...response.headers], [...expected.headers]);
      eq(await response.text(), '');
    });

    it('should serve routes relative to the base path', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION);

      eq((await get('/admin/projections', { basePath: '/admin' })).status, 200);
      eq((await get('/admin/projections/VAT%20Rates/v1', { basePath: '/admin/' })).status, 200);
      eq((await get('/admin/openapi.json', { basePath: '/admin' })).status, 200);
      eq((await get('/projections', { basePath: '/admin' })).status, 404);
    });

    it('should respond with JSON that caches must revalidate', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION);

      for (const route of ['/projections', '/projections/VAT%20Rates/v1', '/openapi.json']) {
        const response = await get(route);
        eq(response.headers.get('Content-Type'), 'application/json', route);
        eq(response.headers.get('Cache-Control'), 'no-cache', route);
      }
    });
  });

  describe('Projections', () => {

    it('should list the live projections by name then version', async (t) => {
      const described = transform(ADD_NESTED_PROJECTION).set('0.description', 'Parks with their seasons');
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_PROJECTION).set('0.version', 2), ADD_ROOT_PROJECTION, ADD_PARK_ENTITIES, described);

      const response = await get('/projections');
      eq(response.status, 200);
      deq(await response.json(), [
        { name: 'Parks', version: 1, description: 'Parks with their seasons', root: { name: 'park', version: 1 } },
        { name: 'VAT Rates', version: 1, description: null, root: { name: 'VAT Rate', version: 1 } },
        { name: 'VAT Rates', version: 2, description: null, root: null },
      ]);
    });

    it('should not list dropped projections', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, transform(ADD_PROJECTION).set('0.version', 2), DROP_PROJECTION);

      deq((await (await get('/projections')).json()).map(({ version }) => version), [2]);
    });

    it('should describe a projection with nests', async (t) => {
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, transform(ADD_NESTED_PROJECTION).set('0.description', 'Parks with their seasons'));

      const response = await get('/projections/Parks/v1');
      eq(response.status, 200);
      deq(await response.json(), {
        name: 'Parks',
        version: 1,
        description: 'Parks with their seasons',
        root: { name: 'park', version: 1 },
        dependencies: [{ name: 'park', version: 1 }, { name: 'rate', version: 1 }, { name: 'season', version: 1 }],
        fields: null,
        order: [{ field: 'name', direction: 'ASC', nulls: null }],
        parameters: [{ name: 'code', field: 'code', match: 'equals', property: ['code'] }],
        paging: { pageSize: 2, pageMax: 3 },
        nests: [
          {
            name: 'seasons',
            lookup: false,
            entity: { name: 'season', version: 1 },
            on: [{ field: 'park_code', parentField: 'code' }],
            fields: null,
            order: [{ field: 'start', direction: 'DESC', nulls: null }, { field: 'type', direction: 'ASC', nulls: null }],
            nests: [
              {
                name: 'rates',
                lookup: false,
                entity: { name: 'rate', version: 1 },
                on: [{ field: 'park_code', parentField: 'park_code' }, { field: 'season_type', parentField: 'type' }],
                fields: null,
                order: [{ field: 'band', direction: 'ASC', nulls: null }],
                nests: [],
              },
            ],
          },
        ],
      });
    });

    it('should describe a lookup after the nests at the same level', async (t) => {
      const lookup = { 'The Park': { entity: 'park@1', on: { Code: 'Park Code' }, fields: ['Name'] } };
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, transform(ADD_NESTED_PROJECTION).set('0.nest.seasons.lookup', lookup));

      const { nests: [seasons] } = await (await get('/projections/Parks/v1')).json();
      deq(seasons.nests.map(({ name }) => name), ['rates', 'the_park']);
      deq(seasons.nests[1], {
        name: 'the_park',
        lookup: true,
        entity: { name: 'park', version: 1 },
        on: [{ field: 'code', parentField: 'park_code' }],
        fields: [{ field: 'name', as: 'name' }],
        order: [],
        nests: [],
      });
    });

    it('should describe selected fields with their aliases in declared order', async (t) => {
      const fields = [{ field: 'Code', as: 'Park' }, { field: 'code', as: 'reference' }, 'Name', 'code'];
      const projection = transform(transform(ADD_NESTED_PROJECTION).set('0.fields', fields)).set('0.nest.seasons.fields', []);
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, projection);

      const declaration = await (await get('/projections/Parks/v1')).json();
      deq(declaration.fields, [
        { field: 'code', as: 'park' },
        { field: 'code', as: 'reference' },
        { field: 'name', as: 'name' },
        { field: 'code', as: 'code' },
      ]);
      deq(declaration.nests[0].fields, []);
      eq(declaration.nests[0].nests[0].fields, null);
    });

    it('should describe the order with its direction and nulls', async (t) => {
      const order = [{ field: 'Name', direction: 'DESC', nulls: 'LAST' }, { field: 'code', nulls: 'FIRST' }];
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, transform(transform(ADD_NESTED_PROJECTION).set('0.order', order)).set('0.nest.seasons.order', [{ field: 'Type', nulls: 'LAST' }]));

      const declaration = await (await get('/projections/Parks/v1')).json();
      deq(declaration.order, [
        { field: 'name', direction: 'DESC', nulls: 'LAST' },
        { field: 'code', direction: 'ASC', nulls: 'FIRST' },
      ]);
      deq(declaration.nests[0].order, [{ field: 'type', direction: 'ASC', nulls: 'LAST' }]);
    });

    it('should describe the paging as null when the projection does not declare it', async (t) => {
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, transform(ADD_NESTED_PROJECTION).del('0.paging'));

      eq((await (await get('/projections/Parks/v1')).json()).paging, null);
    });

    it('should describe parameters on nested fields by their canonical field and document property', async (t) => {
      const parameters = {
        code: { field: 'code' },
        'Season Kind': { field: 'seasons.type' },
        start: { field: 'Seasons.Start', match: 'range' },
        bands: { field: 'seasons.rates.band', match: 'in' },
        park: { field: 'seasons.park.name', match: 'prefix' },
      };
      const projection = transform(transform(transform(ADD_NESTED_PROJECTION).set('0.parameters', parameters)).set('0.nest.seasons.fields', [{ field: 'type', as: 'kind' }, 'start'])).set('0.nest.seasons.lookup', { park: { entity: 'park@1', on: { code: 'park_code' } } });
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, projection);

      deq((await (await get('/projections/Parks/v1')).json()).parameters, [
        { name: 'code', field: 'code', match: 'equals', property: ['code'] },
        { name: 'season_kind', field: 'seasons.type', match: 'equals', property: ['seasons', 'kind'] },
        { name: 'start', field: 'seasons.start', match: 'range', property: ['seasons', 'start'] },
        { name: 'bands', field: 'seasons.rates.band', match: 'in', property: ['seasons', 'rates', 'band'] },
        { name: 'park', field: 'seasons.park.name', match: 'prefix', property: ['seasons', 'park', 'name'] },
      ]);
    });

    it('should describe a parameter on a field the documents do not carry by the lookup field it joins', async (t) => {
      const parameters = { park: { field: 'seasons.park_code', match: 'in' } };
      const lookup = { park: { entity: 'park@1', on: { code: 'park_code' }, fields: [{ field: 'code', as: 'reference' }, 'name'] } };
      const projection = transform(transform(transform(ADD_NESTED_PROJECTION).set('0.parameters', parameters)).set('0.nest.seasons.fields', ['start'])).set('0.nest.seasons.lookup', lookup);
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, projection);

      deq((await (await get('/projections/Parks/v1')).json()).parameters, [
        { name: 'park', field: 'seasons.park_code', match: 'in', property: ['seasons', 'park', 'reference'] },
      ]);
    });

    it('should describe the property of a parameter on a field the documents do not carry as null', async (t) => {
      const parameters = {
        code: { field: 'code' },
        season_park: { field: 'seasons.park_code' },
        rate_park: { field: 'seasons.rates.park_code' },
        end: { field: 'seasons.end', match: 'range' },
      };
      const projection = transform(transform(transform(ADD_NESTED_PROJECTION).set('0.fields', ['name'])).set('0.parameters', parameters)).set('0.nest.seasons.fields', ['type', 'start']);
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, projection);

      deq((await (await get('/projections/Parks/v1')).json()).parameters, [
        { name: 'code', field: 'code', match: 'equals', property: null },
        { name: 'season_park', field: 'seasons.park_code', match: 'equals', property: null },
        { name: 'rate_park', field: 'seasons.rates.park_code', match: 'equals', property: null },
        { name: 'end', field: 'seasons.end', match: 'range', property: null },
      ]);
    });

    it('should describe a parameter by the first lookup that carries the field it joins', async (t) => {
      const parameters = { park: { field: 'seasons.park_code' } };
      const lookup = {
        park: { entity: 'park@1', on: { code: 'park_code' }, fields: ['name'] },
        owner: { entity: 'park@1', on: { code: 'park_code' }, fields: ['code'] },
        site: { entity: 'park@1', on: { code: 'park_code' }, fields: ['code', 'name'] },
      };
      const projection = transform(transform(transform(ADD_NESTED_PROJECTION).set('0.parameters', parameters)).set('0.nest.seasons.fields', ['type', 'start'])).set('0.nest.seasons.lookup', lookup);
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, projection);

      deq((await (await get('/projections/Parks/v1')).json()).parameters, [
        { name: 'park', field: 'seasons.park_code', match: 'equals', property: ['seasons', 'owner', 'code'] },
      ]);
    });

    it('should describe the property of a parameter as null when the lookup it joins does not carry its join field', async (t) => {
      const parameters = { park: { field: 'seasons.park_code' }, rate_park: { field: 'seasons.rates.park_code' } };
      const lookup = { park: { entity: 'park@1', on: { code: 'park_code' }, fields: ['name'] } };
      const rateLookup = { park: { entity: 'park@1', on: { code: 'park_code' } } };
      const projection = transform(transform(transform(transform(ADD_NESTED_PROJECTION).set('0.parameters', parameters)).set('0.nest.seasons.fields', ['type', 'start'])).set('0.nest.seasons.lookup', lookup)).set('0.nest.seasons.nest.rates.lookup', rateLookup);
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, projection);

      deq((await (await get('/projections/Parks/v1')).json()).parameters, [
        { name: 'park', field: 'seasons.park_code', match: 'equals', property: null },
        { name: 'rate_park', field: 'seasons.rates.park_code', match: 'equals', property: null },
      ]);
    });

    it('should describe the property of a parameter on a field carried under several names by the first', async (t) => {
      const fields = [{ field: 'code', as: 'park' }, { field: 'code', as: 'reference' }, 'name'];
      const projection = transform(transform(ADD_NESTED_PROJECTION).set('0.fields', fields)).del('0.nest');
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, projection);

      const declaration = await (await get('/projections/Parks/v1')).json();
      deq(declaration.fields, [{ field: 'code', as: 'park' }, { field: 'code', as: 'reference' }, { field: 'name', as: 'name' }]);
      deq(declaration.parameters.find(({ name }) => name === 'code'), { name: 'code', field: 'code', match: 'equals', property: ['park'] });
    });

    it('should describe a custom SQL projection by its dependencies and paging', async (t) => {
      const dependencies = [{ entity: 'season', version: 1 }, { entity: 'park', version: 1 }];
      const projection = transform(transform(transform(ADD_PROJECTION).set('0.dependencies', dependencies)).set('0.paging', { page_size: 10, page_max: 50 })).set('0.description', 'Rates of VAT');
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PARK_ENTITIES, projection);

      const response = await get('/projections/VAT%20Rates/v1');
      eq(response.status, 200);
      deq(await response.json(), {
        name: 'VAT Rates',
        version: 1,
        description: 'Rates of VAT',
        root: null,
        dependencies: [{ name: 'park', version: 1 }, { name: 'season', version: 1 }],
        fields: null,
        order: [],
        parameters: [],
        paging: { pageSize: 10, pageMax: 50 },
        nests: [],
      });
    });

    it('should respond with 404 for a projection that does not exist', async () => {
      const response = await get('/projections/VAT%20Rates/v1');
      eq(response.status, 404);
      deq(await response.json(), { error: "Projection 'VAT Rates v1' does not exist" });
    });

    it('should respond with 410 for a dropped projection', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, DROP_PROJECTION);

      const response = await get('/projections/VAT%20Rates/v1');
      eq(response.status, 410);
      deq(await response.json(), { error: "Projection 'VAT Rates v1' was dropped" });
    });

    it('should respond with 400 for a projection name that cannot be decoded', async () => {
      const response = await get('/projections/VAT%E0%A4%A/v1');
      eq(response.status, 400);
      deq(await response.json(), { error: "Malformed projection name 'VAT%E0%A4%A'" });
    });

    it('should respond with 400 for a version PostgreSQL rejects', async () => {
      const response = await get('/projections/VAT%20Rates/v99999999999');
      eq(response.status, 400);
      deq(await response.json(), { error: 'value "99999999999" is out of range for type integer' });
    });
  });

  describe('OpenAPI', () => {

    it('should serve a document that validates against the OpenAPI 3.1 schema', async () => {
      const response = await get('/admin/openapi.json', { basePath: '/admin', info: { title: 'Model', version: '2.0.0' } });
      eq(response.status, 200);
      const document = await response.json();
      deq(document.info, { title: 'Model', version: '2.0.0' });
      deq(document.servers, [{ url: '/admin' }]);
      deq(Object.keys(document.paths), ['/projections', '/projections/{name}/v{version}', '/entities', '/entities/{name}/v{version}', '/enums', '/enums/{name}']);
      const { valid, errors } = await new Validator().validate(document);
      deq(errors, undefined);
      eq(valid, true);
    });

    it('should describe the responses of the projection routes', async (t) => {
      const lookup = { park: { entity: 'park@1', on: { code: 'park_code' }, fields: [{ field: 'code', as: 'reference' }] } };
      const parameters = { code: { field: 'code' }, park: { field: 'seasons.park_code' }, end: { field: 'seasons.end', match: 'range' } };
      const projection = transform(transform(ADD_NESTED_PROJECTION).set('0.parameters', parameters)).set('0.nest.seasons.lookup', lookup);
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, ADD_PARK_ENTITIES, transform(projection).set('0.fields', [{ field: 'name', as: 'title' }]));

      const document = await (await get('/openapi.json')).json();
      const ajv = new Ajv({ strict: false });
      ajv.addSchema({ $id: 'declarations', ...document });
      const list = ajv.compile({ type: 'array', items: { $ref: 'declarations#/components/schemas/ProjectionSummary' } });
      const declaration = ajv.compile({ $ref: 'declarations#/components/schemas/ProjectionDeclaration' });

      const projections = await (await get('/projections')).json();
      eq(list(projections), true, JSON.stringify(list.errors));
      for (const route of ['/projections/Parks/v1', '/projections/VAT%20Rates/v1']) {
        const body = await (await get(route)).json();
        eq(declaration(body), true, JSON.stringify(declaration.errors));
      }
      eq(declaration({ ...(await (await get('/projections/Parks/v1')).json()), extra: true }), false);
    });
  });

  describe('Entities', () => {

    const ADD_PARK_SEASON = `
- operation: ADD_ENUM
  name: Customer Type
  values:
    - Guest
    - Owner

- operation: ADD_ENTITY
  name: Park Season
  fields:
    Park Code: TEXT
    Customer Type: Customer Type
    Current Season Start:
      type: DATE
      nullable: false
    Current Season End:
      type: DATE
      nullable: false
    Next Season Start: DATE
    Next Season End: DATE
    Customer Types: Customer Type[]
  key:
    - Park Code
    - Customer Type
  checks:
    season_order: (current_season_start < current_season_end)
    next_season_order: (next_season_start < next_season_end)
`;

    const ADD_PARK_V2 = transform(transform(ADD_PARK_ENTITIES.split('\n\n')[0]).set('0.version', 2)).set('0.description', 'Parks with regions');

    it('should list the entities by name then version', async (t) => {
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, ADD_PARK_V2);

      const response = await get('/entities');
      eq(response.status, 200);
      deq(await response.json(), [
        { name: 'park', version: 1, description: null },
        { name: 'park', version: 2, description: 'Parks with regions' },
        { name: 'rate', version: 1, description: null },
        { name: 'season', version: 1, description: null },
      ]);
    });

    it('should describe an entity with its keys, nullable fields, enum fields and checks', async (t) => {
      await filby.applyYaml(t.name, ADD_PARK_SEASON);

      const response = await get('/entities/Park%20Season/v1');
      eq(response.status, 200);
      deq(await response.json(), {
        name: 'Park Season',
        version: 1,
        description: null,
        fields: [
          { name: 'park_code', type: 'TEXT', key: true, nullable: false },
          { name: 'customer_type', type: 'customer_type', key: true, nullable: false },
          { name: 'current_season_start', type: 'DATE', key: false, nullable: false },
          { name: 'current_season_end', type: 'DATE', key: false, nullable: false },
          { name: 'next_season_start', type: 'DATE', key: false, nullable: true },
          { name: 'next_season_end', type: 'DATE', key: false, nullable: true },
          { name: 'customer_types', type: 'customer_type[]', key: false, nullable: true },
        ],
        checks: [
          { name: 'next_season_order', expression: '(next_season_start < next_season_end)' },
          { name: 'season_order', expression: '(current_season_start < current_season_end)' },
        ],
        projections: [],
      });
    });

    it('should describe an enum field by the name of the enum it uses', async (t) => {
      await filby.applyYaml(t.name, ADD_PARK_SEASON);
      const { rows: [{ name }] } = await filby.withTransaction((tx) => tx.query("SELECT DISTINCT name FROM fby_enum WHERE given_name = 'Customer Type'"));

      const { fields } = await (await get('/entities/Park%20Season/v1')).json();
      eq(fields.find((field) => field.name === 'customer_type').type, name);
      eq(fields.find((field) => field.name === 'customer_types').type, `${name}[]`);
    });

    it('should describe an entity with no dependent projections or checks', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY);

      const response = await get('/entities/VAT%20Rate/v1');
      eq(response.status, 200);
      deq(await response.json(), {
        name: 'VAT Rate',
        version: 1,
        description: null,
        fields: [
          { name: 'type', type: 'TEXT', key: true, nullable: false },
          { name: 'rate', type: 'NUMERIC', key: false, nullable: true },
        ],
        checks: [],
        projections: [],
      });
    });

    it('should list the live projections that read the entity by name then version', async (t) => {
      const seasons = transform(ADD_ROOT_PROJECTION).set('0', { operation: 'ADD_PROJECTION', name: 'Seasons', version: 1, root: 'season@1' });
      const dropParks = transform(DROP_PROJECTION).set('0.name', 'Parks');
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, seasons, ADD_NESTED_PROJECTION, transform(ADD_NESTED_PROJECTION).set('0.version', 2), dropParks);

      deq((await (await get('/entities/season/v1')).json()).projections, [
        { name: 'Parks', version: 2 },
        { name: 'Seasons', version: 1 },
      ]);
      deq((await (await get('/entities/park/v1')).json()).projections, [
        { name: 'Parks', version: 2 },
      ]);
    });

    it('should list the custom SQL projections that depend on the entity', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION);

      deq((await (await get('/entities/VAT%20Rate/v1')).json()).projections, [{ name: 'VAT Rates', version: 1 }]);
    });

    it('should respond with JSON that caches must revalidate', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY);

      for (const route of ['/entities', '/entities/VAT%20Rate/v1']) {
        const response = await get(route);
        eq(response.headers.get('Content-Type'), 'application/json', route);
        eq(response.headers.get('Cache-Control'), 'no-cache', route);
      }
    });

    it('should respond with 404 for an entity that does not exist', async () => {
      const response = await get('/entities/VAT%20Rate/v1');
      eq(response.status, 404);
      deq(await response.json(), { error: "Entity 'VAT Rate v1' does not exist" });
    });

    it('should respond with 404 for a dropped entity', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, DROP_ENTITY);

      const response = await get('/entities/VAT%20Rate/v1');
      eq(response.status, 404);
      deq(await response.json(), { error: "Entity 'VAT Rate v1' does not exist" });
    });

    it('should respond with 400 for an entity name that cannot be decoded', async () => {
      const response = await get('/entities/VAT%E0%A4%A/v1');
      eq(response.status, 400);
      deq(await response.json(), { error: "Malformed entity name 'VAT%E0%A4%A'" });
    });

    it('should respond with 400 for a version PostgreSQL rejects', async () => {
      const response = await get('/entities/VAT%20Rate/v99999999999');
      eq(response.status, 400);
      deq(await response.json(), { error: 'value "99999999999" is out of range for type integer' });
    });

    it('should describe the responses of the entity routes', async (t) => {
      await filby.applyYaml(t.name, ADD_PARK_SEASON, ADD_PARK_ENTITIES, ADD_NESTED_PROJECTION, ADD_PARK_V2);

      const document = await (await get('/openapi.json')).json();
      const ajv = new Ajv({ strict: false });
      ajv.addSchema({ $id: 'declarations', ...document });
      const list = ajv.compile({ type: 'array', items: { $ref: 'declarations#/components/schemas/EntitySummary' } });
      const declaration = ajv.compile({ $ref: 'declarations#/components/schemas/EntityDeclaration' });

      const entities = await (await get('/entities')).json();
      eq(list(entities), true, JSON.stringify(list.errors));
      for (const route of ['/entities/Park%20Season/v1', '/entities/park/v1', '/entities/park/v2']) {
        const body = await (await get(route)).json();
        eq(declaration(body), true, JSON.stringify(declaration.errors));
      }
      eq(declaration({ ...(await (await get('/entities/park/v1')).json()), extra: true }), false);
    });
  });

  describe('Enums', () => {

    const ADD_ENUMS = `
- operation: ADD_ENUM
  name: Customer Type
  values:
    - Guest
    - Owner
- operation: ADD_ENUM
  name: amenity_category
  values:
    - Outdoor
    - Indoor`;

    it('should list every enum by name with its values in declared order', async (t) => {
      await filby.applyYaml(t.name, ADD_ENUMS);

      const response = await get('/enums');
      eq(response.status, 200);
      eq(response.headers.get('Cache-Control'), 'no-cache');
      deq(await response.json(), [
        { name: 'amenity_category', values: ['Outdoor', 'Indoor'] },
        { name: 'customer_type', values: ['Guest', 'Owner'] },
      ]);
    });

    it('should list no enums when none are declared', async () => {
      deq(await (await get('/enums')).json(), []);
    });

    it('should describe an enum by its canonical name', async (t) => {
      await filby.applyYaml(t.name, ADD_ENUMS);

      const response = await get('/enums/customer_type');
      eq(response.status, 200);
      eq(response.headers.get('Cache-Control'), 'no-cache');
      deq(await response.json(), { name: 'customer_type', values: ['Guest', 'Owner'] });
    });

    it('should use the canonical name that an entity field of the enum type has', async (t) => {
      await filby.applyYaml(t.name, ADD_ENUMS, `
- operation: ADD_ENTITY
  name: Season
  fields:
    Park Code: TEXT
    Customer Type: Customer Type
  key:
    - Park Code
    - Customer Type`);

      const { rows: [{ type }] } = await filby.withTransaction((tx) => tx.query("SELECT type FROM fby_entity_field WHERE name = 'customer_type'"));
      eq((await (await get(`/enums/${type}`)).json()).name, type);
    });

    it('should list the values in declared order after ALTER_ENUM', async (t) => {
      await filby.applyYaml(t.name, ADD_ENUMS, `
- operation: ALTER_ENUM
  name: Customer Type
  add:
    - Staff
    - Contractor`);

      deq(await (await get('/enums/customer_type')).json(), { name: 'customer_type', values: ['Guest', 'Owner', 'Staff', 'Contractor'] });
      deq((await (await get('/enums')).json())[1], { name: 'customer_type', values: ['Guest', 'Owner', 'Staff', 'Contractor'] });
    });

    it('should respond with 404 for an enum named as declared rather than canonically', async (t) => {
      await filby.applyYaml(t.name, ADD_ENUMS);

      const response = await get('/enums/Customer%20Type');
      eq(response.status, 404);
      deq(await response.json(), { error: "Enum 'Customer Type' does not exist" });
    });

    it('should respond with 404 for an enum that does not exist', async () => {
      const response = await get('/enums/wombat');
      eq(response.status, 404);
      deq(await response.json(), { error: "Enum 'wombat' does not exist" });
    });

    it('should respond with 404 for a dropped enum', async (t) => {
      await filby.applyYaml(t.name, ADD_ENUMS, `
- operation: DROP_ENUM
  name: Customer Type`);

      eq((await get('/enums/customer_type')).status, 404);
      deq(await (await get('/enums')).json(), [{ name: 'amenity_category', values: ['Outdoor', 'Indoor'] }]);
    });

    it('should respond with 400 for an enum name that cannot be decoded', async () => {
      const response = await get('/enums/%E0%A4%A');
      eq(response.status, 400);
      deq(await response.json(), { error: "Malformed enum name '%E0%A4%A'" });
    });

    it('should describe the responses of the enum routes', async (t) => {
      await filby.applyYaml(t.name, ADD_ENUMS);

      const document = await (await get('/openapi.json')).json();
      deq(document.paths['/enums'].get.operationId, 'listEnumDeclarations');
      deq(document.paths['/enums/{name}'].get.operationId, 'getEnumDeclaration');
      const ajv = new Ajv({ strict: false });
      ajv.addSchema({ $id: 'declarations', ...document });
      const list = ajv.compile({ type: 'array', items: { $ref: 'declarations#/components/schemas/EnumDeclaration' } });
      const declaration = ajv.compile({ $ref: 'declarations#/components/schemas/EnumDeclaration' });

      const enums = await (await get('/enums')).json();
      eq(list(enums), true, JSON.stringify(list.errors));
      eq(declaration(await (await get('/enums/customer_type')).json()), true, JSON.stringify(declaration.errors));
      eq(declaration({ name: 'customer_type', values: ['Guest'], extra: true }), false);
    });
  });

  async function get(route, options) {
    return filby.fetchDeclarations(new Request(`http://localhost${route}`), options);
  }

  function transform(source) {
    const json = YAML.parse(source);
    return {
      set: (...args) => YAML.stringify(op.set(json, ...args)),
      del: (...args) => YAML.stringify(op.del(json, ...args)),
    };
  }
});

function loadYaml(filename) {
  return fs.readFileSync(path.join(import.meta.dirname, 'dsl', 'snippets', `${filename}.yaml`), { encoding: 'utf-8' });
}
