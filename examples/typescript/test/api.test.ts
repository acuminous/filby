import { ok, strictEqual as eq, deepStrictEqual as deq, match } from 'node:assert';
import { describe, it, before, after } from 'node:test';

import config from '../config';
import Application from '../lib/Application';

const CURRENT_CATALOGUE_CHANGE_SET = Date.now() < Date.parse('2027-01-01T00:00:00Z') ? 5 : 10;

describe('API', () => {

  let application: Application;

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

  describe('GET /api/projections', () => {
    it('should list the projections with their descriptions', async () => {
      const response = await get('/api/projections');
      eq(response.status, 200);
      const projections = await response.json();
      deq(projections.map(({ name, version }: any) => `${name} v${version}`), ['Catalogue v1', 'Models v1', 'Parks v1', 'VAT Rates v1']);
      ok(projections.every(({ description }: any) => typeof description === 'string' && description.length > 0));
    });
  });

  describe('What Devon Cliffs sells', () => {
    it('should redirect to the current change set', async () => {
      const response = await get('/api/projections/Parks/v1?code=DC');
      eq(response.status, 307);
      eq(response.headers.get('Location'), '/api/projections/Parks/v1?code=DC&changeSetId=8');
    });

    it('should respond with the park, its amenities, seasons, offers and models', async () => {
      const response = await get('/api/projections/Parks/v1?changeSetId=8&code=DC');
      eq(response.status, 200);
      eq(response.headers.get('X-Total-Count'), '1');
      const [park] = await response.json();
      deq(park, {
        code: 'DC',
        name: 'Devon Cliffs',
        address: 'Sandy Bay',
        town: 'Exmouth',
        county: 'Devon',
        postcode: 'EX8 5BT',
        region: 'South West',
        amenities: ['ARCADE', 'BEACH', 'CLUB', 'GOLF', 'IPOOL', 'OPOOL', 'REST', 'SHOW', 'SPLASH'].map((amenity_code) => ({ amenity_code })),
        seasons: [
          { customer_type: 'Guest', current_season_start: date('2026-03-16'), current_season_end: date('2026-11-03'), next_season_start: date('2027-03-16'), next_season_end: date('2027-11-03') },
          { customer_type: 'Owner', current_season_start: date('2026-03-01'), current_season_end: date('2027-01-06'), next_season_start: date('2027-03-01'), next_season_end: date('2028-01-06') },
        ],
        offers: [{ grade_code: 'Gold', discount_percent: '0.00' }, { grade_code: 'Silver', discount_percent: '5.00' }, { grade_code: 'Bronze', discount_percent: '10.00' }],
        models: ['AMB', 'AVO', 'BEV', 'CAS', 'CLW', 'HEL', 'LOI', 'RIO'].map((model_code) => ({ model_code })),
      });
    });
  });

  describe('The catalogue as it stood on a date', () => {
    it('should list the change sets that affect the catalogue', async () => {
      const response = await get('/api/changelog?projection=Catalogue&version=1');
      eq(response.status, 200);
      const changeLog = await response.json();
      deq(changeLog.map(({ id, effective, description }: any) => ({ id, effective, description })), [
        { id: 2, effective: '2025-01-01T00:00:00.000Z', description: '2025 catalogue and price list' },
        { id: 5, effective: '2026-01-01T00:00:00.000Z', description: '2026 catalogue and price list' },
        { id: 10, effective: '2027-01-01T00:00:00.000Z', description: '2027 catalogue and price list' },
      ]);
    });

    it('should respond with the manufacturers, their models, and each model\'s grades, prices and accessories', async () => {
      const response = await get('/api/projections/Catalogue/v1?changeSetId=5');
      eq(response.status, 200);
      const manufacturers = await response.json();
      deq(manufacturers.map((manufacturer: any) => manufacturer.name), ['ABI', 'Atlas', 'Carnaby', 'Swift', 'Victory', 'Willerby']);

      const [ambleside, arizona, beverley] = manufacturers[0].models;
      eq(ambleside.name, 'ABI Ambleside');
      deq(ambleside.grades, [{ year: 2026, grade_code: 'Gold' }]);
      deq(ambleside.prices, [{ year: 2026, list_price: '22995.00' }]);
      deq(ambleside.accessories, [{ code: 'AMB-DEC', name: 'Decking', price: '3995.00' }, { code: 'AMB-VER', name: 'Veranda', price: '2495.00' }]);

      eq(arizona.name, 'ABI Arizona');
      deq(arizona.grades, [{ year: 2025, grade_code: 'Silver' }]);
      deq(arizona.prices, [{ year: 2025, list_price: '19995.00' }]);
      deq(arizona.accessories, []);

      eq(beverley.name, 'ABI Beverley');
      deq(beverley.prices, [{ year: 2025, list_price: '27495.00' }, { year: 2026, list_price: '28300.00' }]);
    });
  });

  describe('The temporary reduced rate', () => {
    it('should change only the Family Attraction rate between change sets 7 and 9', async () => {
      const during = await (await get('/api/projections/VAT%20Rates/v1?changeSetId=7')).json();
      const after = await (await get('/api/projections/VAT%20Rates/v1?changeSetId=9')).json();
      deq(during, [
        { code: 'Standard', name: 'Standard rate', rate: '20.00' },
        { code: 'Holiday Caravan', name: 'Reduced rate for static holiday caravans', rate: '5.00' },
        { code: 'Residential Caravan', name: 'Zero rate for caravans built to BS 3632', rate: '0.00' },
        { code: 'Family Attraction', name: "Children's meals and family attractions", rate: '5.00' },
      ]);
      deq(after, during.map((rate: any) => (rate.code === 'Family Attraction' ? { ...rate, rate: '20.00' } : rate)));
    });
  });

  describe('The 2027 price list', () => {
    it('should serve a change set that is not yet live without redirecting to it', async () => {
      const redirect = await get('/api/projections/Catalogue/v1');
      eq(redirect.status, 307);
      eq(redirect.headers.get('Location'), `/api/projections/Catalogue/v1?changeSetId=${CURRENT_CATALOGUE_CHANGE_SET}`);

      const response = await get('/api/projections/Catalogue/v1?changeSetId=10&code=VIC');
      eq(response.status, 200);
      const [victory] = await response.json();
      eq(victory.models.length, 1);
      eq(victory.models[0].name, 'Victory Vermont Classic');
      deq(victory.models[0].prices, [{ year: 2025, list_price: '15995.00' }, { year: 2026, list_price: '16450.00' }, { year: 2027, list_price: '16950.00' }]);
      deq(victory.models[0].accessories, [{ code: 'VER-DEC', name: 'Decking', price: '4195.00' }, { code: 'VER-VER', name: 'Veranda', price: '2595.00' }]);
    });
  });

  describe('The rename and the sale', () => {
    it('should rename Richmond and delete Greenacres', async () => {
      const [richmond] = await (await get('/api/projections/Parks/v1?changeSetId=5&code=RI')).json();
      eq(richmond.name, 'Richmond');
      const [skegness] = await (await get('/api/projections/Parks/v1?changeSetId=6&code=RI')).json();
      eq(skegness.name, 'Skegness');
      deq(skegness.amenities, richmond.amenities);

      const before = await get('/api/projections/Parks/v1?changeSetId=7');
      eq(before.headers.get('X-Total-Count'), '10');
      const after = await get('/api/projections/Parks/v1?changeSetId=8');
      eq(after.headers.get('X-Total-Count'), '9');
      deq((await after.json()).map((park: any) => park.name), ['Craig Tara', 'Devon Cliffs', 'Golden Sands', 'Haggerston Castle', 'Kiln Park', 'Primrose Valley', 'Rockley Park', 'Seashore', 'Skegness']);
    });
  });

  describe('GET /api/projections/Models/v1', () => {
    it('should page the models that match the parameters', async () => {
      const response = await get('/api/projections/Models/v1?changeSetId=5&heating=Gas&heating=Electric&berths_from=6&page=1&pageSize=5');
      eq(response.status, 200);
      eq(response.headers.get('X-Total-Count'), '11');
      eq(response.headers.get('Link'), '</api/projections/Models/v1?changeSetId=5&heating=Gas&heating=Electric&berths_from=6&page=2&pageSize=5>; rel="next"');
      const models = await response.json();
      deq(models.map((model: any) => model.code), ['AMB', 'ARZ', 'BEV', 'FES', 'MOO']);

      const lastPage = await get('/api/projections/Models/v1?changeSetId=5&heating=Gas&heating=Electric&berths_from=6&page=3&pageSize=5');
      eq(lastPage.headers.get('Link'), '</api/projections/Models/v1?changeSetId=5&heating=Gas&heating=Electric&berths_from=6&page=2&pageSize=5>; rel="prev"');
      deq((await lastPage.json()).map((model: any) => model.code), ['RIO']);
    });

    it('should filter the models by manufacturer', async () => {
      const response = await get('/api/projections/Models/v1?changeSetId=5&manufacturer=SWI');
      eq(response.status, 200);
      const models = await response.json();
      deq(models.map((model: any) => model.name), ['Swift Challenger 580', 'Swift Loire']);
      eq(models[0].berths, 4);
      eq(models[0].length, '24.5');
      eq(models[0].double_glazed, true);
      eq(models[0].vat_code, 'Standard');
    });
  });

  describe('GET /api/projections/Parks/v1', () => {
    it('should filter the parks by the start of their name', async () => {
      const response = await get('/api/projections/Parks/v1?changeSetId=1&name=G');
      eq(response.status, 200);
      deq((await response.json()).map((park: any) => park.name), ['Golden Sands', 'Greenacres']);
    });

    it('should filter the parks by a list of regions', async () => {
      const response = await get('/api/projections/Parks/v1?changeSetId=1&region=Scotland&region=Wales');
      eq(response.status, 200);
      deq((await response.json()).map((park: any) => park.name), ['Craig Tara', 'Greenacres', 'Kiln Park']);
    });
  });

  describe('GET /api/openapi.json', () => {
    it('should describe the projections', async () => {
      const response = await get('/api/openapi.json');
      eq(response.status, 200);
      const document = await response.json();
      eq(document.info.title, 'Holiday Park Data Service');
      deq(Object.keys(document.paths), ['/projections', '/changelog', '/projections/Catalogue/v1', '/projections/Models/v1', '/projections/Parks/v1', '/projections/VAT%20Rates/v1']);

      const parks = schema(document, 'Parks');
      deq(parks.properties.region, { type: 'string', enum: ['Scotland', 'North East', 'Yorkshire', 'North West', 'Wales', 'Midlands', 'East', 'South East', 'South West'] });
      deq(parks.properties.seasons.items.properties.current_season_start, { type: 'string', format: 'date-time' });
      deq(parks.properties.seasons.items.properties.next_season_start, { type: ['string', 'null'], format: 'date-time' });

      const models = schema(document, 'Models');
      deq(models.properties.berths, { type: 'integer' });
      deq(models.properties.length, { type: 'string' });
      deq(models.properties.double_glazed, { type: 'boolean' });
      deq(models.required, ['code', 'manufacturer_code', 'name', 'berths', 'bedrooms', 'length', 'width', 'heating', 'double_glazed', 'vat_code', 'grades', 'prices', 'accessories']);

      const catalogue = schema(document, 'Catalogue');
      deq(Object.keys(catalogue.properties.models.items.properties.prices.items.properties), ['year', 'list_price']);
    });
  });

  describe('GET /documentation', () => {
    it('should render the generated OpenAPI document', async () => {
      const response = await get('/documentation');
      eq(response.status, 200);
      match(response.headers.get('Content-Type') ?? '', /text\/html/);
      match(await response.text(), /\/api\/openapi\.json/);
    });
  });

  function schema(document: any, projection: string) {
    return document.paths[`/projections/${encodeURIComponent(projection)}/v1`].get.responses['200'].content['application/json'].schema.items;
  }

  function date(day: string) {
    const [year, month, dayOfMonth] = day.split('-').map(Number);
    return new Date(year, month - 1, dayOfMonth).toISOString();
  }

  function get(path: string) {
    return application.app.request(path);
  }
});
