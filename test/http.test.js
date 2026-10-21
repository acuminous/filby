const fs = require('node:fs');
const path = require('node:path');
const { strictEqual: eq, deepEqual: deq, match, rejects } = require('node:assert');
const { describe, it, before, beforeEach, after } = require('node:test');
const YAML = require('yaml');
const op = require('object-path-immutable');
const { Validator } = require('@seriousme/openapi-schema-validator');
const Ajv = require('ajv/dist/2020');
const ajvFormats = require('ajv-formats');

const TestFilby = require('./TestFilby');

const config = {
  nukeCustomObjects: async (tx) => {
    await tx.query('DROP FUNCTION IF EXISTS get_vat_rates_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_parks_v1');
    await tx.query('DROP TABLE IF EXISTS park_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_park_v1_aggregate');
    await tx.query('DROP TABLE IF EXISTS season_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_season_v1_aggregate');
    await tx.query('DROP TABLE IF EXISTS vat_rate_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_vat_rate_v1_aggregate');
    await tx.query('DROP FUNCTION IF EXISTS get_samples_v1');
    await tx.query('DROP TABLE IF EXISTS sample_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_sample_v1_aggregate');
    await tx.query('DROP TYPE IF EXISTS vat_tax_rate');
  },
};

const ADD_ENTITY = loadYaml('ADD_ENTITY');
const ADD_PROJECTION = loadYaml('ADD_PROJECTION');
const ADD_ROOT_PROJECTION = loadYaml('ADD_ROOT_PROJECTION');
const ADD_CHANGE_SET_1 = loadYaml('ADD_CHANGE_SET_1');
const ADD_CHANGE_SET_2 = loadYaml('ADD_CHANGE_SET_2');
const ADD_PARK_ENTITIES = loadYaml('ADD_PARK_ENTITIES');
const ADD_NESTED_PROJECTION = loadYaml('ADD_NESTED_PROJECTION');
const ADD_PARK_CHANGE_SET = loadYaml('ADD_PARK_CHANGE_SET');
const ADD_ENUM = loadYaml('ADD_ENUM');
const ADD_SAMPLE_ENTITY = loadYaml('ADD_SAMPLE_ENTITY');
const ADD_SAMPLE_PROJECTION = loadYaml('ADD_SAMPLE_PROJECTION');
const ADD_SAMPLE_CHANGE_SET = loadYaml('ADD_SAMPLE_CHANGE_SET');

const RFC_1123 = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

describe('HTTP', () => {

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

    it('should respond with 405 for a method other than GET on a known path', async () => {
      const response = await filby.fetch(new Request('http://localhost/changelog?projection=VAT%20Rates&version=1', { method: 'POST' }));
      eq(response.status, 405);
      eq(response.headers.get('Allow'), 'GET');
      deq(await response.json(), { error: 'Method POST is not allowed' });
    });

    it('should serve routes relative to the base path', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      const redirect = await get('/api/projections/VAT%20Rates/v1', { basePath: '/api' });
      eq(redirect.status, 307);
      eq(redirect.headers.get('Location'), `/api/projections/VAT%20Rates/v1?changeSetId=${changeSetId}`);

      const changelog = await get('/api/changelog?projection=VAT%20Rates&version=1', { basePath: '/api' });
      eq(changelog.status, 200);

      const projections = await get('/api/projections', { basePath: '/api' });
      eq(projections.status, 200);
    });

    it('should respond with 404 for a path outside the base path', async () => {
      const response = await get('/changelog?projection=VAT%20Rates&version=1', { basePath: '/api' });
      eq(response.status, 404);
    });

    it('should respond with JSON', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);

      const response = await get('/changelog?projection=VAT%20Rates&version=1');
      eq(response.headers.get('Content-Type'), 'application/json');
    });
  });

  describe('Projection List', () => {

    it('should respond with an empty list when there are no projections', async () => {
      const response = await get('/projections');
      eq(response.status, 200);
      eq(response.headers.get('Content-Type'), 'application/json');
      deq(await response.json(), []);
    });

    it('should list the projections in name and version order', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_ROOT_PROJECTION).set('0.description', 'Rates of VAT'), transform(ADD_PROJECTION).set('0.version', 2), ADD_PARK_ENTITIES, ADD_NESTED_PROJECTION);

      const response = await get('/projections');
      eq(response.status, 200);
      deq(await response.json(), [
        { name: 'Parks', version: 1, description: null },
        { name: 'VAT Rates', version: 1, description: 'Rates of VAT' },
        { name: 'VAT Rates', version: 2, description: null },
      ]);
    });

    it('should not set caching headers', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION);

      const response = await get('/projections');
      eq(response.headers.get('Cache-Control'), null);
      eq(response.headers.get('ETag'), null);
      eq(response.headers.get('Last-Modified'), null);
    });

    it('should respond with 405 for a method other than GET', async () => {
      const response = await filby.fetch(new Request('http://localhost/projections', { method: 'POST' }));
      eq(response.status, 405);
      eq(response.headers.get('Allow'), 'GET');
      deq(await response.json(), { error: 'Method POST is not allowed' });
    });
  });

  describe('Changelog', () => {

    it('should respond with the change log for the projection', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1, ADD_CHANGE_SET_2);
      const projection = await filby.getProjection('VAT Rates', 1);
      const [first, second] = await filby.getChangeLog(projection);

      const response = await get('/changelog?projection=VAT%20Rates&version=1');
      eq(response.status, 200);
      const changelog = await response.json();
      eq(changelog.length, 2);
      deq(changelog[0], { id: first.id, effective: '2020-04-05T00:00:00.000Z', description: '2020 VAT Rates', lastModified: first.lastModified.toISOString(), entityTag: first.entityTag });
      deq(changelog[1], { id: second.id, effective: '2021-04-05T00:00:00.000Z', description: '2021 VAT Rates', lastModified: second.lastModified.toISOString(), entityTag: second.entityTag });
    });

    it('should set caching headers from the latest change set', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1, ADD_CHANGE_SET_2);
      const projection = await filby.getProjection('VAT Rates', 1);
      const [, second] = await filby.getChangeLog(projection);

      const response = await get('/changelog?projection=VAT%20Rates&version=1');
      eq(response.headers.get('ETag'), second.entityTag);
      eq(response.headers.get('Last-Modified'), second.lastModified.toUTCString());
      match(response.headers.get('Last-Modified'), RFC_1123);
      eq(response.headers.get('Cache-Control'), null);
    });

    it('should list change sets since a change set id', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1, ADD_CHANGE_SET_2);
      const projection = await filby.getProjection('VAT Rates', 1);
      const [first, second] = await filby.getChangeLog(projection);

      const response = await get(`/changelog?projection=VAT%20Rates&version=1&since=${first.id}`);
      eq(response.status, 200);
      deq((await response.json()).map(({ id }) => id), [second.id]);
      eq(response.headers.get('ETag'), second.entityTag);
    });

    it('should respond with an empty change log when there is nothing since the change set id', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      const response = await get(`/changelog?projection=VAT%20Rates&version=1&since=${changeSetId}`);
      eq(response.status, 200);
      deq(await response.json(), []);
      eq(response.headers.get('ETag'), null);
      eq(response.headers.get('Last-Modified'), null);
    });

    it('should respond with an empty change log when the projection has no change sets', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION);

      const response = await get('/changelog?projection=VAT%20Rates&version=1');
      eq(response.status, 200);
      deq(await response.json(), []);
      eq(response.headers.get('ETag'), null);
      eq(response.headers.get('Last-Modified'), null);
    });

    it('should respond with 400 when the projection is missing', async () => {
      const response = await get('/changelog?version=1');
      eq(response.status, 400);
      deq(await response.json(), { error: "Missing query parameter 'projection'" });
    });

    it('should respond with 400 when the version is missing', async () => {
      const response = await get('/changelog?projection=VAT%20Rates');
      eq(response.status, 400);
      deq(await response.json(), { error: "Missing query parameter 'version'" });
    });

    it('should respond with 400 when the version is not an integer', async () => {
      const response = await get('/changelog?projection=VAT%20Rates&version=1.1');
      eq(response.status, 400);
      deq(await response.json(), { error: "Query parameter 'version' must be an integer" });
    });

    it('should respond with 400 when since is not an integer', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);

      const response = await get('/changelog?projection=VAT%20Rates&version=1&since=abc');
      eq(response.status, 400);
      deq(await response.json(), { error: "Query parameter 'since' must be an integer" });
    });

    it('should respond with 404 when the projection does not exist', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);

      const response = await get('/changelog?projection=VAT%20Rates&version=2');
      eq(response.status, 404);
      deq(await response.json(), { error: "Projection 'VAT Rates v2' does not exist" });
    });
  });

  describe('Projections', () => {

    it('should redirect to the current change set', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1, ADD_CHANGE_SET_2);
      const changeSetId = await getChangeSetId('2021 VAT Rates');

      const response = await get('/projections/VAT%20Rates/v1');
      eq(response.status, 307);
      eq(response.headers.get('Location'), `/projections/VAT%20Rates/v1?changeSetId=${changeSetId}`);
    });

    it('should preserve the query when redirecting', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      const response = await get('/projections/VAT%20Rates/v1?type=standard&page=2');
      eq(response.status, 307);
      eq(response.headers.get('Location'), `/projections/VAT%20Rates/v1?type=standard&page=2&changeSetId=${changeSetId}`);
    });

    it('should respond with 404 when there is no current change set', async (t) => {
      const nextYear = new Date().getFullYear() + 1;
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, transform(ADD_CHANGE_SET_1).set('0.effective', `${nextYear}-01-01T00:00:00.000Z`));

      const response = await get('/projections/VAT%20Rates/v1');
      eq(response.status, 404);
      deq(await response.json(), { error: "Projection 'VAT Rates v1' has no current change set" });
    });

    it('should respond with 404 when the projection does not exist', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);

      const unknownName = await get('/projections/CGT%20Rates/v1');
      eq(unknownName.status, 404);
      deq(await unknownName.json(), { error: "Projection 'CGT Rates v1' does not exist" });

      const unknownVersion = await get('/projections/VAT%20Rates/v2?changeSetId=1');
      eq(unknownVersion.status, 404);
      deq(await unknownVersion.json(), { error: "Projection 'VAT Rates v2' does not exist" });

      const badVersion = await get('/projections/VAT%20Rates/1');
      eq(badVersion.status, 404);
    });

    it('should respond with 400 when the projection name is malformed', async () => {
      const response = await get('/projections/VAT%E0%A4%A/v1');
      eq(response.status, 400);
      deq(await response.json(), { error: "Malformed projection name 'VAT%E0%A4%A'" });
    });

    it('should respond with 400 when the change set id is not an integer', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);

      const response = await get('/projections/VAT%20Rates/v1?changeSetId=abc');
      eq(response.status, 400);
      deq(await response.json(), { error: "Query parameter 'changeSetId' must be an integer" });
    });

    it('should respond with 400 when the change set does not exist', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);

      const response = await get('/projections/VAT%20Rates/v1?changeSetId=999');
      eq(response.status, 400);
      deq(await response.json(), { error: 'Change set 999 does not exist' });
    });

    it('should respond with the documents for the change set', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1, ADD_CHANGE_SET_2);
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      const response = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}&pageSize=3`);
      eq(response.status, 200);
      deq(await response.json(), [
        { type: 'zero', rate: '0' },
        { type: 'reduced', rate: '0.05' },
        { type: 'standard', rate: '0.1' },
      ]);
    });

    it('should set caching headers from the change set', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);
      const changeSetId = await getChangeSetId('2020 VAT Rates');
      const changeSet = await filby.getChangeSet(changeSetId);

      const response = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}`);
      eq(response.headers.get('ETag'), changeSet.entityTag);
      eq(response.headers.get('Last-Modified'), changeSet.lastModified.toUTCString());
      match(response.headers.get('Last-Modified'), RFC_1123);
      eq(response.headers.get('Cache-Control'), 'max-age=31536000, immutable');
      eq(response.headers.get('X-Total-Count'), '3');
    });

    it('should serve the same entity tag for every page and parameter combination at a change set', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      const page1 = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}`);
      const page2 = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}&page=2`);
      const filtered = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}&type=standard`);
      eq(page1.headers.get('ETag'), page2.headers.get('ETag'));
      eq(page1.headers.get('ETag'), filtered.headers.get('ETag'));
    });

    it('should page documents with link headers', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, setRates({ a: 0.1, b: 0.2, c: 0.3, d: 0.4, e: 0.5 }));
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      const page1 = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}`);
      eq(page1.status, 200);
      deq((await page1.json()).map(({ type }) => type), ['a', 'b']);
      eq(page1.headers.get('X-Total-Count'), '5');
      eq(page1.headers.get('Link'), `</projections/VAT%20Rates/v1?changeSetId=${changeSetId}&page=2>; rel="next"`);

      const page2 = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}&page=2`);
      deq((await page2.json()).map(({ type }) => type), ['c', 'd']);
      eq(page2.headers.get('X-Total-Count'), '5');
      eq(page2.headers.get('Link'), `</projections/VAT%20Rates/v1?changeSetId=${changeSetId}&page=1>; rel="prev", </projections/VAT%20Rates/v1?changeSetId=${changeSetId}&page=3>; rel="next"`);

      const page3 = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}&page=3`);
      deq((await page3.json()).map(({ type }) => type), ['e']);
      eq(page3.headers.get('X-Total-Count'), '5');
      eq(page3.headers.get('Link'), `</projections/VAT%20Rates/v1?changeSetId=${changeSetId}&page=2>; rel="prev"`);

      const page4 = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}&page=4`);
      eq(page4.status, 200);
      deq(await page4.json(), []);
      eq(page4.headers.get('X-Total-Count'), '5');
      eq(page4.headers.get('Link'), `</projections/VAT%20Rates/v1?changeSetId=${changeSetId}&page=3>; rel="prev"`);
    });

    it('should clamp the page size to the declared maximum', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, setRates({ a: 0.1, b: 0.2, c: 0.3, d: 0.4, e: 0.5 }));
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      const page1 = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}&pageSize=10`);
      deq((await page1.json()).map(({ type }) => type), ['a', 'b', 'c']);
      eq(page1.headers.get('Link'), `</projections/VAT%20Rates/v1?changeSetId=${changeSetId}&pageSize=10&page=2>; rel="next"`);

      const page2 = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}&pageSize=10&page=2`);
      deq((await page2.json()).map(({ type }) => type), ['d', 'e']);
      eq(page2.headers.get('Link'), `</projections/VAT%20Rates/v1?changeSetId=${changeSetId}&pageSize=10&page=1>; rel="prev"`);
    });

    it('should preserve other query parameters in link headers', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, setRates({ a: 0.1, b: 0.2, c: 0.3, d: 0.4, e: 0.5 }));
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      const response = await get(`/projections/VAT%20Rates/v1?above=0.1&changeSetId=${changeSetId}&pageSize=1&page=2`);
      deq((await response.json()).map(({ type }) => type), ['c']);
      eq(response.headers.get('X-Total-Count'), '4');
      eq(response.headers.get('Link'), `</projections/VAT%20Rates/v1?above=0.1&changeSetId=${changeSetId}&pageSize=1&page=1>; rel="prev", </projections/VAT%20Rates/v1?above=0.1&changeSetId=${changeSetId}&pageSize=1&page=3>; rel="next"`);
    });

    it('should respond with 400 when page or pageSize is not a positive integer', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      for (const query of ['page=0', 'page=abc', 'page=1.5', 'pageSize=0', 'pageSize=abc']) {
        const response = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}&${query}`);
        eq(response.status, 400, query);
        deq(await response.json(), { error: `Query parameter '${query.split('=')[0]}' must be a positive integer` });
      }
    });

    it('should respond with 400 for page or pageSize when the projection has no paging', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_ROOT_PROJECTION).del('0.paging'), ADD_CHANGE_SET_1);
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      const response = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}&page=1`);
      eq(response.status, 400);
      deq(await response.json(), { error: "Projection 'VAT Rates v1' has no paging" });
    });

    it('should serve every document when the projection has no paging', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_ROOT_PROJECTION).del('0.paging'), setRates({ a: 0.1, b: 0.2, c: 0.3, d: 0.4, e: 0.5 }));
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      const response = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}`);
      eq(response.status, 200);
      deq((await response.json()).map(({ type }) => type), ['a', 'b', 'c', 'd', 'e']);
      eq(response.headers.get('X-Total-Count'), '5');
      eq(response.headers.get('Link'), null);
    });

    it('should filter documents by declared parameters', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      const equals = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}&type=standard`);
      deq((await equals.json()).map(({ type }) => type), ['standard']);
      eq(equals.headers.get('X-Total-Count'), '1');

      const prefix = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}&prefix=s`);
      deq((await prefix.json()).map(({ type }) => type), ['standard']);

      const range = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}&rate_from=0.01&rate_to=0.05`);
      deq((await range.json()).map(({ type }) => type), ['reduced']);

      const above = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}&above=0.05`);
      deq((await above.json()).map(({ type }) => type), ['standard']);
    });

    it('should filter documents by an in parameter with repeated keys', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      const response = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}&types=standard&types=zero`);
      deq((await response.json()).map(({ type }) => type), ['zero', 'standard']);
    });

    it('should respond with 400 for an undeclared query parameter', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      const response = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}&wombat=1`);
      eq(response.status, 400);
      deq(await response.json(), { error: "Projection 'VAT Rates v1' has no parameter 'wombat'; existing parameters are 'type', 'prefix', 'types', 'rate_from', 'rate_to', 'above', 'at_least', 'below', 'at_most'" });
    });

    it('should respond with 400 when a parameter that is not an in match is repeated', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      const response = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}&type=standard&type=zero`);
      eq(response.status, 400);
      deq(await response.json(), { error: "Query parameter 'type' must not be repeated" });
    });

    it('should respond with 400 when a parameter value cannot be converted', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      const response = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}&above=abc`);
      eq(response.status, 400);
      deq(await response.json(), { error: 'invalid input syntax for type numeric: "abc"' });
    });

    it('should read the page number rather than a declared parameter named page', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_ROOT_PROJECTION).set('0.parameters.page', { field: 'type' }), setRates({ a: 0.1, b: 0.2, c: 0.3 }));
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      const response = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}&page=2`);
      deq((await response.json()).map(({ type }) => type), ['c']);
    });

    it('should serve nested documents', async (t) => {
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, ADD_NESTED_PROJECTION, ADD_PARK_CHANGE_SET);
      const changeSetId = await getChangeSetId('2019 Parks');

      const response = await get(`/projections/Parks/v1?changeSetId=${changeSetId}&code=DC`);
      eq(response.status, 200);
      eq(response.headers.get('X-Total-Count'), '1');
      deq(await response.json(), [
        {
          code: 'DC',
          name: 'Devon Cliffs',
          seasons: [
            { type: 'Guests', start: '2019-03-15T00:00:00.000Z', end: '2019-11-15T00:00:00.000Z' },
            { type: 'Owners', start: '2019-03-01T00:00:00.000Z', end: '2019-11-30T00:00:00.000Z' },
            { type: 'Guests', start: '2019-02-01T00:00:00.000Z', end: '2019-02-28T00:00:00.000Z' },
          ],
        },
      ]);
    });

    it('should rethrow errors the handler does not expect', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);
      const changeSetId = await getChangeSetId('2020 VAT Rates');
      await filby.withTransaction((tx) => tx.query('DROP FUNCTION get_vat_rates_v1'));

      await rejects(() => get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}`), { code: '42883' });
    });
  });

  describe('Raw Projections', () => {

    it('should serve the rows of the projection function', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, ADD_CHANGE_SET_1);
      await createRawProjection();
      const changeSetId = await getChangeSetId('2020 VAT Rates');
      const changeSet = await filby.getChangeSet(changeSetId);

      const response = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}`);
      eq(response.status, 200);
      deq(await response.json(), [
        { type: 'reduced', rate: '0.05' },
        { type: 'standard', rate: '0.1' },
        { type: 'zero', rate: '0' },
      ]);
      eq(response.headers.get('X-Total-Count'), '3');
      eq(response.headers.get('Link'), null);
      eq(response.headers.get('ETag'), changeSet.entityTag);
      eq(response.headers.get('Last-Modified'), changeSet.lastModified.toUTCString());
      eq(response.headers.get('Cache-Control'), 'max-age=31536000, immutable');
    });

    it('should redirect to the current change set', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, ADD_CHANGE_SET_1);
      await createRawProjection();
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      const response = await get('/projections/VAT%20Rates/v1');
      eq(response.status, 307);
      eq(response.headers.get('Location'), `/projections/VAT%20Rates/v1?changeSetId=${changeSetId}`);
    });

    it('should page rows with link headers', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, ADD_CHANGE_SET_1);
      await createRawProjection();
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      const page1 = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}&pageSize=2`);
      deq((await page1.json()).map(({ type }) => type), ['reduced', 'standard']);
      eq(page1.headers.get('X-Total-Count'), '3');
      eq(page1.headers.get('Link'), `</projections/VAT%20Rates/v1?changeSetId=${changeSetId}&pageSize=2&page=2>; rel="next"`);

      const page2 = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}&pageSize=2&page=2`);
      deq((await page2.json()).map(({ type }) => type), ['zero']);
      eq(page2.headers.get('X-Total-Count'), '3');
      eq(page2.headers.get('Link'), `</projections/VAT%20Rates/v1?changeSetId=${changeSetId}&pageSize=2&page=1>; rel="prev"`);
    });

    it('should respond with 400 for a page without a page size', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, ADD_CHANGE_SET_1);
      await createRawProjection();
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      const response = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}&page=2`);
      eq(response.status, 400);
      deq(await response.json(), { error: "Query parameter 'page' requires 'pageSize'" });
    });

    it('should respond with 400 for any other query parameter', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, ADD_CHANGE_SET_1);
      await createRawProjection();
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      const response = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}&type=standard`);
      eq(response.status, 400);
      deq(await response.json(), { error: "Projection 'VAT Rates v1' has no parameter 'type'; it has no parameters" });
    });

    it('should respond with 500 when the projection function does not exist', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, ADD_CHANGE_SET_1);
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      const response = await get(`/projections/VAT%20Rates/v1?changeSetId=${changeSetId}`);
      eq(response.status, 500);
      deq(await response.json(), { error: "Function 'get_vat_rates_v1' does not exist" });
    });

    async function createRawProjection() {
      await filby.withTransaction((tx) => tx.query(`
        CREATE FUNCTION get_vat_rates_v1(p_change_set_id INTEGER)
        RETURNS TABLE (type TEXT, rate NUMERIC)
        AS $$
          SELECT type, rate FROM get_vat_rate_v1_aggregate(p_change_set_id) ORDER BY type
        $$ LANGUAGE sql STABLE`));
    }
  });

  describe('OpenAPI', () => {

    const ajv = new Ajv();
    ajvFormats(ajv);

    it('should serve a document that validates against the OpenAPI 3.1 schema', async (t) => {
      await filby.applyYaml(t.name, ADD_ENUM, ADD_ENTITY, ADD_ROOT_PROJECTION, transform(ADD_PROJECTION).set('0.version', 2), ADD_PARK_ENTITIES, ADD_NESTED_PROJECTION, ADD_SAMPLE_ENTITY, ADD_SAMPLE_PROJECTION);

      const response = await get('/openapi.json');
      eq(response.status, 200);
      eq(response.headers.get('Content-Type'), 'application/json');
      eq(response.headers.get('Cache-Control'), null);
      eq(response.headers.get('ETag'), null);
      const document = await response.json();
      eq(document.openapi, '3.1.0');
      deq(Object.keys(document.paths), ['/projections', '/changelog', '/projections/Parks/v1', '/projections/Samples/v1', '/projections/VAT%20Rates/v1', '/projections/VAT%20Rates/v2']);
      const { valid, errors } = await new Validator().validate(document);
      deq(errors, undefined);
      eq(valid, true);
    });

    it('should describe the projection list', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_ROOT_PROJECTION).set('0.description', 'Rates of VAT'), transform(ADD_PROJECTION).set('0.version', 2));

      const { paths, components } = await getDocument();
      const { get: operation } = paths['/projections'];
      eq(operation.operationId, 'getProjections');
      eq(operation.parameters, undefined);
      deq(Object.keys(operation.responses), ['200']);
      eq(operation.responses['200'].headers, undefined);
      deq(operation.responses['200'].content['application/json'].schema, { type: 'array', items: { $ref: '#/components/schemas/Projection' } });
      deq(components.schemas.Projection, {
        type: 'object',
        properties: {
          name: { type: 'string' },
          version: { type: 'integer' },
          description: { type: ['string', 'null'] },
        },
        required: ['name', 'version', 'description'],
        additionalProperties: false,
      });

      const validate = ajv.compile({ type: 'array', items: components.schemas.Projection, minItems: 2 });
      const projections = await (await get('/projections')).json();
      eq(validate(projections), true, JSON.stringify(validate.errors));
    });

    it('should describe the change log', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1, ADD_CHANGE_SET_2);

      const { paths, components } = await getDocument();
      const { get: operation } = paths['/changelog'];
      eq(operation.operationId, 'getChangeLog');
      deq(operation.parameters, [
        { name: 'projection', in: 'query', required: true, schema: { type: 'string' } },
        { name: 'version', in: 'query', required: true, schema: { type: 'integer' } },
        { name: 'since', in: 'query', schema: { type: 'integer' } },
      ]);
      deq(Object.keys(operation.responses), ['200', '400', '404']);
      deq(Object.keys(operation.responses['200'].headers), ['ETag', 'Last-Modified']);
      deq(operation.responses['200'].content['application/json'].schema, { type: 'array', items: { $ref: '#/components/schemas/ChangeSet' } });
      deq(operation.responses['400'].content['application/json'].schema, { $ref: '#/components/schemas/Error' });
      deq(operation.responses['404'].content['application/json'].schema, { $ref: '#/components/schemas/Error' });
      deq(components.schemas.ChangeSet, {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          effective: { type: 'string', format: 'date-time' },
          description: { type: 'string' },
          lastModified: { type: 'string', format: 'date-time' },
          entityTag: { type: 'string' },
          reissuedFrom: { type: 'integer' },
        },
        required: ['id', 'effective', 'description', 'lastModified', 'entityTag'],
        additionalProperties: false,
      });
      deq(components.schemas.Error, { type: 'object', properties: { error: { type: 'string' } }, required: ['error'], additionalProperties: false });

      const validate = ajv.compile({ type: 'array', items: components.schemas.ChangeSet, minItems: 2 });
      const changeLog = await (await get('/changelog?projection=VAT%20Rates&version=1')).json();
      eq(validate(changeLog), true, JSON.stringify(validate.errors));
    });

    it('should describe a root projection', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_ROOT_PROJECTION).set('0.description', 'Rates of VAT'));

      const { paths } = await getDocument();
      const { get: operation } = paths['/projections/VAT%20Rates/v1'];
      eq(operation.operationId, 'get_vat_rates_v1');
      eq(operation.summary, 'VAT Rates v1');
      eq(operation.description, 'Rates of VAT');
      deq(operation.parameters, [
        { name: 'changeSetId', in: 'query', schema: { type: 'integer' } },
        { name: 'type', in: 'query', schema: { type: 'string' } },
        { name: 'prefix', in: 'query', schema: { type: 'string' } },
        { name: 'types', in: 'query', schema: { type: 'array', items: { type: 'string' } }, style: 'form', explode: true },
        { name: 'rate_from', in: 'query', schema: { type: 'string' } },
        { name: 'rate_to', in: 'query', schema: { type: 'string' } },
        { name: 'above', in: 'query', schema: { type: 'string' } },
        { name: 'at_least', in: 'query', schema: { type: 'string' } },
        { name: 'below', in: 'query', schema: { type: 'string' } },
        { name: 'at_most', in: 'query', schema: { type: 'string' } },
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, default: 2, maximum: 3 } },
      ]);
      deq(Object.keys(operation.responses), ['200', '307', '400', '404']);
      deq(Object.keys(operation.responses['200'].headers), ['ETag', 'Last-Modified', 'Cache-Control', 'X-Total-Count', 'Link']);
      deq(Object.keys(operation.responses['307'].headers), ['Location']);
      deq(operation.responses['400'].content['application/json'].schema, { $ref: '#/components/schemas/Error' });
      deq(operation.responses['404'].content['application/json'].schema, { $ref: '#/components/schemas/Error' });
    });

    it('should omit the projection description when there is none', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION);

      const { paths } = await getDocument();
      eq(paths['/projections/VAT%20Rates/v1'].get.description, undefined);
    });

    it('should omit the paging parameters when the projection has no paging', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_ROOT_PROJECTION).del('0.paging'));

      const { paths } = await getDocument();
      const names = paths['/projections/VAT%20Rates/v1'].get.parameters.map(({ name }) => name);
      deq(names, ['changeSetId', 'type', 'prefix', 'types', 'rate_from', 'rate_to', 'above', 'at_least', 'below', 'at_most']);
    });

    it('should omit a declared parameter named page', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_ROOT_PROJECTION).set('0.parameters', { page: { field: 'type' } }));

      const { paths } = await getDocument();
      deq(paths['/projections/VAT%20Rates/v1'].get.parameters.map(({ name }) => name), ['changeSetId', 'page', 'pageSize']);
    });

    it('should describe the documents of a nested projection', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_PARK_ENTITIES, ADD_NESTED_PROJECTION, ADD_PARK_CHANGE_SET);
      const changeSetId = await getChangeSetId('2019 Parks');

      const { paths } = await getDocument();
      deq(paths['/projections/VAT%20Rates/v1'].get.responses['200'].content['application/json'].schema, {
        type: 'array',
        items: {
          type: 'object',
          properties: { type: { type: 'string' }, rate: { type: ['string', 'null'] } },
          required: ['type'],
          additionalProperties: false,
        },
      });
      const { schema } = paths['/projections/Parks/v1'].get.responses['200'].content['application/json'];
      deq(schema, {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            code: { type: 'string' },
            name: { type: ['string', 'null'] },
            seasons: {
              type: 'array',
              items: {
                type: 'object',
                properties: { type: { type: 'string' }, start: { type: 'string', format: 'date-time' }, end: { type: ['string', 'null'], format: 'date-time' } },
                required: ['type', 'start'],
                additionalProperties: false,
              },
            },
          },
          required: ['code', 'seasons'],
          additionalProperties: false,
        },
      });

      const documents = await (await get(`/projections/Parks/v1?changeSetId=${changeSetId}`)).json();
      eq(documents.length, 2);
      const validate = ajv.compile(schema);
      eq(validate(documents), true, JSON.stringify(validate.errors));
      eq(validate([{ code: 'DC', name: 'Devon Cliffs', seasons: [{ type: 'Guests', start: '2019-03-15T00:00:00.000Z', end: '2019-11-15T00:00:00.000Z', park_code: 'DC' }] }]), false);
    });

    it('should map field types to what node-pg emits', async (t) => {
      await filby.applyYaml(t.name, ADD_ENUM, ADD_SAMPLE_ENTITY, ADD_SAMPLE_PROJECTION, ADD_SAMPLE_CHANGE_SET);
      const changeSetId = await getChangeSetId('2020 Samples');

      const { paths } = await getDocument();
      const { schema } = paths['/projections/Samples/v1'].get.responses['200'].content['application/json'];
      deq(schema.items.properties, {
        id: { type: 'integer' },
        big: { type: 'string' },
        amount: { type: 'string' },
        ratio: { type: ['number', 'null'] },
        flag: { type: 'boolean' },
        day: { type: 'string', format: 'date-time' },
        occurred: { type: 'string', format: 'date-time' },
        code: { type: 'string' },
        ref: { type: 'string', format: 'uuid' },
        extra: {},
        tags: { type: ['array', 'null'], items: { type: 'string' } },
        category: { anyOf: [{ type: 'string', enum: ['standard', 'reduced', 'zero'] }, { type: 'null' }] },
        span: {},
      });
      deq(schema.items.required, ['id', 'big', 'amount', 'flag', 'day', 'occurred', 'code', 'ref', 'span']);

      const documents = await (await get(`/projections/Samples/v1?changeSetId=${changeSetId}`)).json();
      eq(documents.length, 2);
      eq(documents[0].big, '9007199254740993');
      eq(documents[0].amount, '12.34');
      deq(documents[0].tags, ['x', 'y']);
      eq(documents[1].category, null);
      const validate = ajv.compile(schema);
      eq(validate(documents), true, JSON.stringify(validate.errors));
    });

    it('should describe a projection declared with dependencies', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION);

      const { paths } = await getDocument();
      const { get: operation } = paths['/projections/VAT%20Rates/v1'];
      eq(operation.operationId, 'get_vat_rates_v1');
      deq(operation.parameters, [
        { name: 'changeSetId', in: 'query', schema: { type: 'integer' } },
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1 } },
      ]);
      deq(operation.responses['200'].content['application/json'].schema, { type: 'array', items: { type: 'object' } });
    });

    it('should serve the document under the base path', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION);

      const response = await get('/api/openapi.json', { basePath: '/api' });
      eq(response.status, 200);
      const document = await response.json();
      deq(document.servers, [{ url: '/api' }]);
      deq(Object.keys(document.paths), ['/projections', '/changelog', '/projections/VAT%20Rates/v1']);

      const outside = await get('/openapi.json', { basePath: '/api' });
      eq(outside.status, 404);
    });

    it('should omit servers when there is no base path', async () => {
      const document = await getDocument();
      eq(document.servers, undefined);
    });

    it('should take info from the options', async () => {
      const document = await getDocument({ info: { title: 'Holiday Parks', version: '2.0.0', description: 'Parks and their seasons' } });
      deq(document.info, { title: 'Holiday Parks', version: '2.0.0', description: 'Parks and their seasons' });
    });

    it('should default info', async () => {
      const document = await getDocument();
      deq(document.info, { title: 'Filby', version: '1.0.0' });
    });

    async function getDocument(options) {
      const response = await get('/openapi.json', options);
      eq(response.status, 200);
      return response.json();
    }
  });

  async function get(path, options) {
    return filby.fetch(new Request(`http://localhost${path}`), options);
  }

  async function getChangeSetId(description) {
    const { rows } = await filby.withTransaction((tx) => tx.query('SELECT id FROM fby_change_set WHERE description = $1', [description]));
    return rows[0].id;
  }

  function setRates(rates) {
    const data = Object.entries(rates).map(([type, rate]) => ({ type, rate }));
    return transform(ADD_CHANGE_SET_1).set('0.frames', [{ entity: 'VAT Rate', version: 1, action: 'SET', data }]);
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
  return fs.readFileSync(path.join(__dirname, 'dsl', 'snippets', `${filename}.yaml`), { encoding: 'utf-8' });
}
