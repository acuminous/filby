const { ok, strictEqual: eq, deepStrictEqual: deq, match } = require('node:assert');
const { describe, it, before, after } = require('node:test');

const config = require('../config');
const Application = require('../lib/Application');

const RFC_1123 = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;

describe('API', () => {

  let application;

  before(async () => {
    application = new Application({ config });
    await application.start();
  });

  after(async () => {
    await application.stop();
  });

  describe('GET /health', () => {
    it('should report the notification status', async () => {
      const response = await get('/health');
      eq(response.status, 200);
      const status = await response.json();
      eq(status.started, true);
      ok(['idle', 'running'].includes(status.poller));
      eq(status.failuresSinceLastSuccess, 0);
      eq(typeof status.pending, 'number');
      eq(typeof status.overdue, 'number');
      eq(typeof status.exhausted, 'number');
    });
  });

  describe('GET /api/changelog', () => {
    it('should respond with the change log for the projection', async () => {
      const response = await get('/api/changelog?projection=park&version=1');
      eq(response.status, 200);
      const changeLog = await response.json();
      eq(changeLog.length, 9);
      assertChangeSet(changeLog[0], { id: 1, effective: '2019-01-01T00:00:00.000Z', description: 'Initial Data' });
      assertChangeSet(changeLog[8], { id: 9, effective: '2024-01-01T00:00:00.000Z', description: '2024 Season' });
    });

    it('should respond with 400 when the projection query parameter is missing', async () => {
      const response = await get('/api/changelog?version=1');
      eq(response.status, 400);
      deq(await response.json(), { error: "Missing query parameter 'projection'" });
    });

    it('should respond with 400 when the version query parameter is missing', async () => {
      const response = await get('/api/changelog?projection=park');
      eq(response.status, 400);
    });

    it('should respond with 400 when the version query parameter is not an integer', async () => {
      const response = await get('/api/changelog?projection=park&version=1.1');
      eq(response.status, 400);
    });

    it('should respond with 404 when the projection does not exist', async () => {
      const response = await get('/api/changelog?projection=park&version=2');
      eq(response.status, 404);
      deq(await response.json(), { error: "Projection 'park v2' does not exist" });
    });

    it('should encourage caching', async () => {
      const response = await get('/api/changelog?projection=park&version=1');
      match(header(response, 'Last-Modified'), RFC_1123);
      match(header(response, 'ETag'), /^[0-9a-f]{20}$/);
    });
  });

  describe('GET /api/projections/park/v1', () => {
    it('should redirect to the current change set', async () => {
      const response = await get('/api/projections/park/v1');
      eq(response.status, 307);
      eq(response.headers.get('Location'), '/api/projections/park/v1?changeSetId=9');
    });

    it('should respond with the parks at the specified change set', async () => {
      const parks1 = await (await get('/api/projections/park/v1?changeSetId=1')).json();
      eq(parks1.length, 3);
      assertPark(parks1[0], { code: 'DC', name: 'Devon Cliffs' });
      assertPark(parks1[2], { code: 'PV', name: 'Primrose Valley' });

      eq(parks1[0].seasons.length, 2);
      assertSeason(parks1[0].seasons[0], { type: 'Guests', start: '2019-03-15T00:00:00.000Z', end: '2019-11-15T00:00:00.000Z' });
      assertSeason(parks1[0].seasons[1], { type: 'Owners', start: '2019-03-01T00:00:00.000Z', end: '2019-11-30T00:00:00.000Z' });

      const parks8 = await (await get('/api/projections/park/v1?changeSetId=8')).json();
      eq(parks8.length, 3);
      assertPark(parks8[0], { code: 'DC', name: 'Devon Cliffs' });
      assertPark(parks8[2], { code: 'SK', name: 'Skegness' });

      eq(parks8[0].seasons.length, 10);
      assertSeason(parks8[0].seasons[0], { type: 'Guests', start: '2023-03-15T00:00:00.000Z', end: '2023-11-15T00:00:00.000Z' });
      assertSeason(parks8[0].seasons[9], { type: 'Owners', start: '2019-03-01T00:00:00.000Z', end: '2019-11-30T00:00:00.000Z' });
    });

    it('should filter the parks by code', async () => {
      const response = await get('/api/projections/park/v1?changeSetId=1&code=DC');
      eq(response.status, 200);
      const parks = await response.json();
      eq(parks.length, 1);
      assertPark(parks[0], { code: 'DC', name: 'Devon Cliffs' });
    });

    it('should respond with 404 when the projection does not exist', async () => {
      const response = await get('/api/projections/park/v2?changeSetId=8');
      eq(response.status, 404);
    });

    it('should respond with 400 when the change set does not exist', async () => {
      const response = await get('/api/projections/park/v1?changeSetId=99');
      eq(response.status, 400);
      deq(await response.json(), { error: 'Change set 99 does not exist' });
    });

    it('should encourage caching', async () => {
      const response = await get('/api/projections/park/v1?changeSetId=8');
      match(header(response, 'Last-Modified'), RFC_1123);
      match(header(response, 'ETag'), /^[0-9a-f]{20}$/);
      eq(response.headers.get('Cache-Control'), 'max-age=31536000, immutable');
    });
  });

  describe('GET /api/projections/park/v1/code/:code', () => {
    it('should redirect to the current change set', async () => {
      const response = await get('/api/projections/park/v1/code/DC');
      eq(response.status, 307);
      eq(response.headers.get('Location'), '/api/projections/park/v1/code/DC?changeSetId=9');
    });

    it('should respond with the park at the specified change set', async () => {
      const greenacres = await (await get('/api/projections/park/v1/code/GA?changeSetId=1')).json();
      assertPark(greenacres, { code: 'GA', name: 'Greenacres' });
      eq(greenacres.seasons.length, 2);
      assertSeason(greenacres.seasons[0], { type: 'Guests', start: '2019-03-15T00:00:00.000Z', end: '2019-11-15T00:00:00.000Z' });
      assertSeason(greenacres.seasons[1], { type: 'Owners', start: '2019-03-01T00:00:00.000Z', end: '2019-11-30T00:00:00.000Z' });

      const skegness = await (await get('/api/projections/park/v1/code/SK?changeSetId=8')).json();
      assertPark(skegness, { code: 'SK', name: 'Skegness' });
      eq(skegness.seasons.length, 6);
      assertSeason(skegness.seasons[0], { type: 'Guests', start: '2023-03-15T00:00:00.000Z', end: '2023-11-15T00:00:00.000Z' });
      assertSeason(skegness.seasons[5], { type: 'Owners', start: '2021-03-01T00:00:00.000Z', end: '2021-11-30T00:00:00.000Z' });
    });

    it('should ignore the case of the code', async () => {
      const response = await get('/api/projections/park/v1/code/dc?changeSetId=1');
      eq(response.status, 200);
      assertPark(await response.json(), { code: 'DC', name: 'Devon Cliffs' });
    });

    it('should respond with 404 before the park was created', async () => {
      const response = await get('/api/projections/park/v1/code/SK?changeSetId=1');
      eq(response.status, 404);
      deq(await response.json(), { error: "Park 'SK' does not exist in change set 1" });
    });

    it('should respond with 404 after the park was deleted', async () => {
      const response = await get('/api/projections/park/v1/code/GA?changeSetId=8');
      eq(response.status, 404);
    });

    it('should respond with 400 when the change set does not exist', async () => {
      const response = await get('/api/projections/park/v1/code/DC?changeSetId=99');
      eq(response.status, 400);
      deq(await response.json(), { error: 'Change set 99 does not exist' });
    });

    it('should respond with 400 when the change set id is not an integer', async () => {
      const response = await get('/api/projections/park/v1/code/DC?changeSetId=nine');
      eq(response.status, 400);
    });

    it('should encourage caching', async () => {
      const response = await get('/api/projections/park/v1/code/DC?changeSetId=8');
      match(header(response, 'Last-Modified'), RFC_1123);
      match(header(response, 'ETag'), /^[0-9a-f]{20}$/);
      eq(response.headers.get('Cache-Control'), 'max-age=31536000, immutable');
    });
  });

  describe('GET /api/openapi.json', () => {
    it('should describe the park projection', async () => {
      const response = await get('/api/openapi.json');
      eq(response.status, 200);
      const document = await response.json();
      eq(document.info.title, 'Holiday Park Data Service');
      ok(document.paths['/projections/park/v1']);
    });
  });

  describe('GET /documentation', () => {
    it('should render the generated OpenAPI document', async () => {
      const response = await get('/documentation');
      eq(response.status, 200);
      match(header(response, 'Content-Type'), /text\/html/);
      match(await response.text(), /\/api\/openapi\.json/);
    });
  });

  function header(response, name) {
    return response.headers.get(name) ?? '';
  }

  function assertChangeSet(actual, expected) {
    eq(actual.id, expected.id);
    eq(actual.effective, expected.effective);
    eq(actual.description, expected.description);
    match(actual.lastModified, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
    match(actual.entityTag, /^[0-9a-f]{20}$/);
  }

  function assertPark(actual, expected) {
    eq(actual.code, expected.code);
    eq(actual.name, expected.name);
  }

  function assertSeason(actual, expected) {
    eq(actual.type, expected.type);
    eq(actual.start, expected.start);
    eq(actual.end, expected.end);
  }

  function get(path) {
    return application.app.request(path);
  }
});
