const { ok, strictEqual: eq, deepEqual: deq, rejects, match } = require('node:assert');
const { describe, it, before, beforeEach, after, afterEach } = require('zunit');
const axios = require('axios');

const config = require('../config.json');
const Application = require('../lib/Application');

describe('API', () => {

  let application;

  before(async () => {
    const testConfig = { ...config, fastify: { logger: false } };
    application = new Application({ config: testConfig });
    await application.start();
  });

  after(async () => {
    await application.stop();
  });

  describe('GET /api/changelog', () => {
    it('should respond with changelog for valid projection', async () => {
      const { data: changeLog } = await get('api/changelog?projection=park&version=1');
      eq(changeLog.length, 8);
      assertChangeSet(changeLog[0], { id: 1, effective: '2019-01-01T00:00:00.000Z', description: 'Initial Data' });
      assertChangeSet(changeLog[7], { id: 8, effective: '2023-01-01T00:00:00.000Z', description: 'Park Calendars - 2023' });
    });

    it('should respond with 400 when missing park query parameter', async () => {
      const { status } = await get('api/changelog?version=1');
      eq(status, 400);
    });

    it('should respond with 400 when missing version query parameter', async () => {
      const { status } = await get('api/changelog?projection=park');
      eq(status, 400);
    });

    it('should respond with 400 when version query parameter is not an integer', async () => {
      const { status } = await get('api/changelog?projection=park&version=1.1');
      eq(status, 400);
    });

    it('should respond with 404 when projection does not exist', async () => {
      const { status } = await get('api/changelog?projection=park&version=2');
      eq(status, 404);
    });

    it('should encourage caching', async () => {
      const { headers } = await get('api/changelog?projection=park&version=1');
      match(headers.get('Last-Modified'), /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/);
      match(headers.get('ETag'), /^[0-9a-f]{20}$/);
    });
  });

  describe('GET /api/projection/v1/park', () => {
    it('should redirect to current change set', async () => {
      const { status, headers } = await get('api/projection/v1/park');
      eq(status, 307);
      eq(headers.location, '/api/projection/v1/park?changeSetId=8');
    });

    it('should response with parks for specified change set', async () => {
      const { data: parks1 } = await get('api/projection/v1/park?changeSetId=1');
      eq(parks1.length, 3);
      assertPark(parks1[0], { code: 'DC', name: 'Devon Cliffs' });
      assertPark(parks1[2], { code: 'PV', name: 'Primrose Valley' });

      const { data: park8 } = await get('api/projection/v1/park?changeSetId=8');
      eq(park8.length, 3);
      assertPark(park8[0], { code: 'DC', name: 'Devon Cliffs' });
      assertPark(park8[2], { code: 'SK', name: 'Skegness' });
    });

    it('should respond with 404 when projection does not exist', async () => {
      const { status } = await get('api/projection/v2/park?changeSetId=8');
      eq(status, 404);
    });

    it('should respond with 400 when change set does not exist', async () => {
      const { status } = await get('api/projection/v2/park?changeSetId=9');
      eq(status, 404);
    });

    it('should encourage caching', async () => {
      const { headers } = await get('api/projection/v1/park?changeSetId=8');
      match(headers.get('Last-Modified'), /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/);
      match(headers.get('ETag'), /^[0-9a-f]{20}$/);
      eq(headers.get('Cache-Control'), 'max-age=31536000, immutable');
    });
  });

  describe('GET /api/projection/v1/park/code/DC', () => {
    it('should redirect to current change set', async () => {
      const { status, headers } = await get('api/projection/v1/park/code/DC');
      eq(status, 307);
      eq(headers.location, '/api/projection/v1/park/code/DC?changeSetId=8');
    });

    it('should response with park for specified change set', async () => {
      const { data: park1 } = await get('api/projection/v1/park/code/GA?changeSetId=1');
      assertPark(park1, { code: 'GA', name: 'Greenacres' });

      const { status: status1 } = await get('api/projection/v1/park/code/GA?changeSetId=8');
      eq(status1, 404);

      const { status: status8 } = await get('api/projection/v1/park/code/SK?changeSetId=1');
      eq(status8, 404);

      const { data: park8 } = await get('api/projection/v1/park/code/SK?changeSetId=8');
      assertPark(park8, { code: 'SK', name: 'Skegness' });

    });

    it('should respond with 404 when projection does not exist', async () => {
      const { status } = await get('api/projection/v2/park/code/DC?changeSetId=8');
      eq(status, 404);
    });

    it('should respond with 404 when park does not exist', async () => {
      const { status } = await get('api/projection/v2/park/code/GA?changeSetId=8');
      eq(status, 404);
    });

    it('should respond with 400 when change set does not exist', async () => {
      const { status } = await get('api/projection/v2/park/code/DC?changeSetId=9');
      eq(status, 404);
    });

    it('should encourage caching', async () => {
      const { headers } = await get('api/projection/v1/park?changeSetId=8');
      match(headers.get('Last-Modified'), /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/);
      match(headers.get('ETag'), /^[0-9a-f]{20}$/);
      eq(headers.get('Cache-Control'), 'max-age=31536000, immutable');
    });
  });

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

  async function get(path, options = { method: 'GET', validateStatus: () => true, maxRedirects: 0 }) {
    return axios.get(`http://localhost:3000/${path}`, options);
  }
});
