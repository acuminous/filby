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
  })

  after(async () => {
    await application.stop();
  });

  describe('GET /api/changelog', () => {
    it('should respond with changelog for valid projection', async () => {
      const { data: changeLog } = await axios.get('http://localhost:3000/api/changelog?projection=park&version=1');
      eq(changeLog.length, 8);
      assertChangeSet(changeLog[0], { id: 1, effective: '2019-01-01T00:00:00.000Z', description: 'Initial Data' });
      assertChangeSet(changeLog[7], { id: 8, effective: '2023-01-01T00:00:00.000Z', description: 'Park Calendars - 2023' });
    })

    it('should respond with 400 when missing park query parameter', async () => {
      const { status } = await axios.get('http://localhost:3000/api/changelog?version=1', { validateStatus: () => true });
      eq(status, 400);
    })

    it('should respond with 400 when missing version query parameter', async () => {
      const { status } = await axios.get('http://localhost:3000/api/changelog?projection=park', { validateStatus: () => true });
      eq(status, 400);
    })

    it('should respond with 400 when version query parameter is not a number', async () => {
      const { status } = await axios.get('http://localhost:3000/api/changelog?projection=park&version=v', { validateStatus: () => true });
      eq(status, 400);
    })

    it('should respond with 404 when projection does not exist', async () => {
      const { status } = await axios.get('http://localhost:3000/api/changelog?projection=park&version=2', { validateStatus: () => true });
      eq(status, 404);
    })

  })

  function assertChangeSet(actual, expected) {
    eq(actual.id, expected.id);
    eq(actual.effective, expected.effective);
    eq(actual.description, expected.description);
    match(actual.lastModified, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
    match(actual.entityTag, /^[0-9a-f]{20}$/);
  }
})