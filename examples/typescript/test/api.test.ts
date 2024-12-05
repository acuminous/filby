import { ok, strictEqual as eq, deepEqual as deq, rejects, match } from 'node:assert';
import { describe, it, before, beforeEach, after, afterEach } from 'zunit';
import axios, { AxiosResponseHeaders } from 'axios';

import config from '../config.json';
import Application from '../lib/Application';

export default describe('API', () => {

  let application: Application;

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
      eq(changeLog.length, 9);
      assertChangeSet(changeLog[0], { id: 1, effective: '2019-01-01T00:00:00.000Z', description: 'Initial Data' });
      assertChangeSet(changeLog[8], { id: 9, effective: '2024-01-01T00:00:00.000Z', description: '2024 Season' });
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
      let { headers } = await get('api/changelog?projection=park&version=1');
      match(headers.get('Last-Modified'), /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/);
      match(headers.get('ETag'), /^[0-9a-f]{20}$/);
    });
  });

  describe('GET /api/projection/v1/park', () => {
    it('should redirect to current change set', async () => {
      const { status, headers } = await get('api/projection/v1/park');
      eq(status, 307);
      eq(headers.get('Location'), '/api/projection/v1/park?changeSetId=9');
    });

    it('should response with parks for specified change set', async () => {
      const { data: parks1 } = await get('api/projection/v1/park?changeSetId=1');
      eq(parks1.length, 3);
      assertPark(parks1[0], { code: 'DC', name: 'Devon Cliffs' });
      assertPark(parks1[2], { code: 'PV', name: 'Primrose Valley' });

      eq(parks1[0].seasons.length, 2);
      assertSeason(parks1[0].seasons[0], { type: 'Guests', start: '2019-03-15T00:00:00.000Z', end: '2019-11-15T00:00:00.000Z' });      
      assertSeason(parks1[0].seasons[1], { type: 'Owners', start: '2019-03-01T00:00:00.000Z', end: '2019-11-30T00:00:00.000Z' });

      const { data: parks8 } = await get('api/projection/v1/park?changeSetId=8');
      eq(parks8.length, 3);
      assertPark(parks8[0], { code: 'DC', name: 'Devon Cliffs' });
      assertPark(parks8[2], { code: 'SK', name: 'Skegness' });

      eq(parks8[0].seasons.length, 10);
      assertSeason(parks8[0].seasons[0], { type: 'Guests', start: '2023-03-15T00:00:00.000Z', end: '2023-11-15T00:00:00.000Z' });
      assertSeason(parks8[0].seasons[9], { type: 'Owners', start: '2019-03-01T00:00:00.000Z', end: '2019-11-30T00:00:00.000Z' });
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

  describe('GET /api/projection/v1/park/code/:code', () => {
    it('should redirect to current change set', async () => {
      const { status, headers } = await get('api/projection/v1/park/code/DC');
      eq(status, 307);
      eq(headers.get('Location'), '/api/projection/v1/park/code/DC?changeSetId=9');
    });

    it('should response with park for specified change set', async () => {
      const { data: greenacres } = await get('api/projection/v1/park/code/GA?changeSetId=1');
      assertPark(greenacres, { code: 'GA', name: 'Greenacres' });
      eq(greenacres.seasons.length, 2);
      assertSeason(greenacres.seasons[0], { type: 'Guests', start: '2019-03-15T00:00:00.000Z', end: '2019-11-15T00:00:00.000Z' });
      assertSeason(greenacres.seasons[1], { type: 'Owners', start: '2019-03-01T00:00:00.000Z', end: '2019-11-30T00:00:00.000Z'  });

      const { data: skegness } = await get('api/projection/v1/park/code/SK?changeSetId=8');
      assertPark(skegness, { code: 'SK', name: 'Skegness' });
      eq(skegness.seasons.length, 6);
      assertSeason(skegness.seasons[0], { type: 'Guests', start: '2023-03-15T00:00:00.000Z', end: '2023-11-15T00:00:00.000Z' });
      assertSeason(skegness.seasons[5], { type: 'Owners', start: '2021-03-01T00:00:00.000Z', end: '2021-11-30T00:00:00.000Z' });
    });

    it('should response with 404 before park was created', async () => {
      const { status } = await get('api/projection/v1/park/code/SK?changeSetId=1');
      eq(status, 404);
    });

    it('should response with 404 after park was deleted', async () => {
      const { status } = await get('api/projection/v1/park/code/GA?changeSetId=8');
      eq(status, 404);
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

  function assertChangeSet(actual: any, expected: any) {
    eq(actual.id, expected.id);
    eq(actual.effective, expected.effective);
    eq(actual.description, expected.description);
    match(actual.lastModified, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
    match(actual.entityTag, /^[0-9a-f]{20}$/);
  }

  function assertPark(actual: any, expected: any) {
    eq(actual.code, expected.code);
    eq(actual.name, expected.name);
  }

  function assertSeason(actual: any, expected: any) {
    eq(actual.type, expected.type);
    eq(actual.start, expected.start);
    eq(actual.end, expected.end);
  }

  async function get(path: string, options = { method: 'GET', validateStatus: () => true, maxRedirects: 0 }) {
    const { status, headers, data } = await axios.get(`http://localhost:3000/${path}`, options);
    return { status, headers: new SafeHeaders(headers as AxiosResponseHeaders), data };
  }
});

class SafeHeaders {
  #headers: AxiosResponseHeaders;

  constructor(headers: AxiosResponseHeaders) {
    this.#headers = headers;
  }

  get(name: string) {
    return this.#headers && String(this.#headers.get(name)) || '';
  }
}
