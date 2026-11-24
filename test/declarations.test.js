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
  },
};

const ADD_ENTITY = loadYaml('ADD_ENTITY');
const ADD_PROJECTION = loadYaml('ADD_PROJECTION');
const ADD_ROOT_PROJECTION = loadYaml('ADD_ROOT_PROJECTION');
const ADD_PARK_ENTITIES = loadYaml('ADD_PARK_ENTITIES');
const ADD_NESTED_PROJECTION = loadYaml('ADD_NESTED_PROJECTION');
const DROP_PROJECTION = loadYaml('DROP_PROJECTION');

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
      deq(Object.keys(document.paths), ['/projections', '/projections/{name}/v{version}', '/hooks', '/hooks/{name}']);
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

  describe('Hooks', () => {

    const ADD_HOOK_ADD_PROJECTION = loadYaml('ADD_HOOK_ADD_PROJECTION');
    const ADD_HOOK_DROP_PROJECTION = loadYaml('ADD_HOOK_DROP_PROJECTION');
    const ADD_HOOK_CHANGE_SET_GENERAL = loadYaml('ADD_HOOK_CHANGE_SET_GENERAL');
    const ADD_HOOK_CHANGE_SET_PROJECTION = loadYaml('ADD_HOOK_CHANGE_SET_PROJECTION');
    const ADD_HOOK_COMMENCE_CHANGE_SET = YAML.stringify([{
      operation: 'ADD_HOOK',
      name: 'sns/commence-change-set/vat-rates-v1',
      description: 'Publishes the current VAT rates',
      event: 'COMMENCE_CHANGE_SET',
      projection: 'VAT Rates@1',
    }]);

    it('should list the hooks by name', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_HOOK_DROP_PROJECTION, ADD_HOOK_COMMENCE_CHANGE_SET, ADD_HOOK_CHANGE_SET_PROJECTION, ADD_HOOK_ADD_PROJECTION, ADD_HOOK_CHANGE_SET_GENERAL);

      const response = await get('/hooks');
      eq(response.status, 200);
      deq(await response.json(), [
        { name: 'sns/add-change-set/*', description: null, event: 'ADD_CHANGE_SET', projection: null },
        { name: 'sns/add-change-set/vat-rates-v1', description: null, event: 'ADD_CHANGE_SET', projection: { name: 'VAT Rates', version: 1 } },
        { name: 'sns/add-projection', description: null, event: 'ADD_PROJECTION', projection: null },
        { name: 'sns/commence-change-set/vat-rates-v1', description: 'Publishes the current VAT rates', event: 'COMMENCE_CHANGE_SET', projection: { name: 'VAT Rates', version: 1 } },
        { name: 'sns/drop-projection', description: null, event: 'DROP_PROJECTION', projection: null },
      ]);
    });

    it('should list no hooks when none are declared', async () => {
      deq(await (await get('/hooks')).json(), []);
    });

    it('should describe a hook on one projection by its URL-encoded name', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_HOOK_COMMENCE_CHANGE_SET);

      const response = await get('/hooks/sns%2Fcommence-change-set%2Fvat-rates-v1');
      eq(response.status, 200);
      deq(await response.json(), {
        name: 'sns/commence-change-set/vat-rates-v1',
        description: 'Publishes the current VAT rates',
        event: 'COMMENCE_CHANGE_SET',
        projection: { name: 'VAT Rates', version: 1 },
      });
    });

    it('should describe a hook on every projection', async (t) => {
      await filby.applyYaml(t.name, ADD_HOOK_CHANGE_SET_GENERAL);

      const response = await get('/hooks/sns%2Fadd-change-set%2F*');
      eq(response.status, 200);
      deq(await response.json(), { name: 'sns/add-change-set/*', description: null, event: 'ADD_CHANGE_SET', projection: null });
    });

    it('should respond with JSON that caches must revalidate', async (t) => {
      await filby.applyYaml(t.name, ADD_HOOK_CHANGE_SET_GENERAL);

      for (const route of ['/hooks', '/hooks/sns%2Fadd-change-set%2F*']) {
        const response = await get(route);
        eq(response.headers.get('Content-Type'), 'application/json', route);
        eq(response.headers.get('Cache-Control'), 'no-cache', route);
      }
    });

    it('should respond with 404 for a hook that does not exist', async () => {
      const response = await get('/hooks/sns%2Fadd-change-set%2F*');
      eq(response.status, 404);
      deq(await response.json(), { error: "Hook 'sns/add-change-set/*' does not exist" });
    });

    it('should respond with 404 for a hook that was dropped', async (t) => {
      await filby.applyYaml(t.name, ADD_HOOK_CHANGE_SET_GENERAL, loadYaml('DROP_HOOK_ADD_CHANGE_SET_GENERAL'));

      eq((await get('/hooks/sns%2Fadd-change-set%2F*')).status, 404);
      deq(await (await get('/hooks')).json(), []);
    });

    it('should leave out the hooks of a dropped projection', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_HOOK_CHANGE_SET_PROJECTION, ADD_HOOK_COMMENCE_CHANGE_SET, ADD_HOOK_CHANGE_SET_GENERAL, DROP_PROJECTION);

      deq((await (await get('/hooks')).json()).map(({ name }) => name), ['sns/add-change-set/*']);
      const response = await get('/hooks/sns%2Fadd-change-set%2Fvat-rates-v1');
      eq(response.status, 404);
      deq(await response.json(), { error: "Hook 'sns/add-change-set/vat-rates-v1' does not exist" });
    });

    it('should respond with 400 for a hook name that cannot be decoded', async () => {
      const response = await get('/hooks/sns%E0%A4%A');
      eq(response.status, 400);
      deq(await response.json(), { error: "Malformed hook name 'sns%E0%A4%A'" });
    });

    it('should respond with 404 for a hook name whose slashes are not encoded', async (t) => {
      await filby.applyYaml(t.name, ADD_HOOK_CHANGE_SET_GENERAL);

      eq((await get('/hooks/sns/add-change-set/*')).status, 404);
    });

    it('should describe the responses of the hook routes', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_HOOK_COMMENCE_CHANGE_SET, ADD_HOOK_CHANGE_SET_GENERAL);

      const document = await (await get('/openapi.json')).json();
      deq(Object.keys(document.paths['/hooks/{name}'].get.responses), ['200', '400', '404']);
      const ajv = new Ajv({ strict: false });
      ajv.addSchema({ $id: 'declarations', ...document });
      const list = ajv.compile({ type: 'array', items: { $ref: 'declarations#/components/schemas/HookDeclaration' } });
      const declaration = ajv.compile({ $ref: 'declarations#/components/schemas/HookDeclaration' });

      const hooks = await (await get('/hooks')).json();
      eq(hooks.length, 2);
      eq(list(hooks), true, JSON.stringify(list.errors));
      for (const route of ['/hooks/sns%2Fcommence-change-set%2Fvat-rates-v1', '/hooks/sns%2Fadd-change-set%2F*']) {
        const body = await (await get(route)).json();
        eq(declaration(body), true, JSON.stringify(declaration.errors));
      }
      eq(declaration({ ...hooks[0], extra: true }), false);
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
