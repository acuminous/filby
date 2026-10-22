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
      deq(projections.map(({ name, version }: any) => `${name} v${version}`), ['Amenities v1', 'Beaches v1', 'Catalogue v1', 'Grades v1', 'Models v1', 'Parks (Detailed) v1', 'Parks (Minimal) v1', 'VAT Rates v1']);
      ok(projections.every(({ description }: any) => typeof description === 'string' && description.length > 0));
    });
  });

  describe('What Devon Cliffs sells', () => {
    const devonCliffs = {
      code: 'DC',
      name: 'Devon Cliffs',
      address: 'Sandy Bay',
      town: 'Exmouth',
      county: 'Devon',
      postcode: 'EX8 5BT',
      region: 'South West',
      seasons: [
        { customer_type: 'Guest', current_season_start: '2026-03-16T00:00:00.000Z', current_season_end: '2026-11-03T00:00:00.000Z', next_season_start: '2027-03-16T00:00:00.000Z', next_season_end: '2027-11-03T00:00:00.000Z' },
        { customer_type: 'Owner', current_season_start: '2026-03-01T00:00:00.000Z', current_season_end: '2027-01-06T00:00:00.000Z', next_season_start: '2027-03-01T00:00:00.000Z', next_season_end: '2028-01-06T00:00:00.000Z' },
      ],
      offers: [
        { grade_code: 'Platinum', discount_percent: '0.00' },
        { grade_code: 'Gold', discount_percent: '2.50' },
        { grade_code: 'Silver', discount_percent: '5.00' },
        { grade_code: 'Bronze', discount_percent: '7.50' },
        { grade_code: 'Saver', discount_percent: '10.00' },
      ],
      models: ['AMB', 'AVO', 'BEV', 'CAS', 'CLW', 'HEL', 'LOI', 'RIO'].map((model_code) => ({ model_code })),
      beach_routes: [
        { beach_code: 'SANDY_BAY', name: 'Along the beach road', distance_metres: 1200, accessibility: 'Step Free' },
        { beach_code: 'SANDY_BAY', name: 'Via the cliff path', distance_metres: 400, accessibility: 'Steep Steps' },
      ],
    };

    it('should redirect to the current change set', async () => {
      const response = await get('/api/projections/Parks%20(Detailed)/v1?code=DC');
      eq(response.status, 307);
      eq(response.headers.get('Location'), '/api/projections/Parks%20(Detailed)/v1?code=DC&changeSetId=8');
    });

    it('should respond with the park, its amenities and beach routes in full, seasons, offers and models', async () => {
      const response = await get('/api/projections/Parks%20(Detailed)/v1?changeSetId=8&code=DC');
      eq(response.status, 200);
      eq(response.headers.get('X-Total-Count'), '1');
      const [park] = await response.json();
      deq(park, {
        ...devonCliffs,
        amenities: [
          { amenity_code: 'AMUSEMENT_ARCADE', amenity: { name: 'Amusement Arcade', category: 'Entertainment', age_group: 'All Ages', charge: 'Paid', vat_code: 'Family Attraction' } },
          { amenity_code: 'CRAZY_GOLF', amenity: { name: 'Crazy Golf', category: 'Sport', age_group: 'All Ages', charge: 'Paid', vat_code: 'Family Attraction' } },
          { amenity_code: 'INDOOR_POOL', amenity: { name: 'Indoor Pool', category: 'Pool', age_group: 'All Ages', charge: 'Free', vat_code: 'Family Attraction' } },
          { amenity_code: 'KIDS_CLUB', amenity: { name: 'Kids Club', category: 'Entertainment', age_group: 'Children', charge: 'Free', vat_code: 'Family Attraction' } },
          { amenity_code: 'OUTDOOR_POOL', amenity: { name: 'Outdoor Pool', category: 'Pool', age_group: 'All Ages', charge: 'Free', vat_code: 'Family Attraction' } },
          { amenity_code: 'RESTAURANT', amenity: { name: 'Restaurant', category: 'Food', age_group: 'All Ages', charge: 'Paid', vat_code: 'Standard' } },
          { amenity_code: 'SHOWBAR', amenity: { name: 'Showbar', category: 'Entertainment', age_group: 'All Ages', charge: 'Free', vat_code: 'Family Attraction' } },
          { amenity_code: 'SPLASH_ZONE', amenity: { name: 'Splash Zone', category: 'Pool', age_group: 'Children', charge: 'Free', vat_code: 'Family Attraction' } },
        ],
        beach_routes: devonCliffs.beach_routes.map((route) => ({ ...route, beach: { name: 'Sandy Bay', surfaces: '{Sandy,Rocky}' } })),
      });
    });

    it('should respond with the same park and its amenity and beach codes from the minimal projection', async () => {
      const redirect = await get('/api/projections/Parks%20(Minimal)/v1?code=DC');
      eq(redirect.status, 307);
      eq(redirect.headers.get('Location'), '/api/projections/Parks%20(Minimal)/v1?code=DC&changeSetId=8');

      const response = await get('/api/projections/Parks%20(Minimal)/v1?changeSetId=8&code=DC');
      eq(response.status, 200);
      eq(response.headers.get('X-Total-Count'), '1');
      const [park] = await response.json();
      deq(park, {
        ...devonCliffs,
        amenities: ['AMUSEMENT_ARCADE', 'CRAZY_GOLF', 'INDOOR_POOL', 'KIDS_CLUB', 'OUTDOOR_POOL', 'RESTAURANT', 'SHOWBAR', 'SPLASH_ZONE'].map((amenity_code) => ({ amenity_code })),
      });
    });
  });

  describe('Which beach a park reaches', () => {
    it('should redirect to the change set that loaded the beaches', async () => {
      const response = await get('/api/projections/Beaches/v1');
      eq(response.status, 307);
      eq(response.headers.get('Location'), '/api/projections/Beaches/v1?changeSetId=1');
    });

    it('should respond with the beaches in name order, each with its surfaces', async () => {
      const response = await get('/api/projections/Beaches/v1?changeSetId=1');
      eq(response.status, 200);
      const beaches = await response.json();
      deq(beaches.map((beach: any) => beach.name), ['Black Rock Sands', 'Great Yarmouth North Beach', 'Heads of Ayr', 'Hunmanby Gap', 'Mablethorpe Beach', 'Rockley Point', 'Sandy Bay', 'Tenby Castle Beach', 'Tenby South Beach']);
      deq(beaches.find((beach: any) => beach.code === 'SANDY_BAY'), { code: 'SANDY_BAY', name: 'Sandy Bay', surfaces: '{Sandy,Rocky}' });
    });

    it('should list two beaches for Kiln Park, one route to each', async () => {
      const [kilnPark] = await (await get('/api/projections/Parks%20(Minimal)/v1?changeSetId=8&code=KP')).json();
      deq(kilnPark.beach_routes, [
        { beach_code: 'TENBY_CASTLE', name: 'Into town past the harbour', distance_metres: 1800, accessibility: 'Steps' },
        { beach_code: 'TENBY_SOUTH', name: 'Through the dunes', distance_metres: 300, accessibility: 'Step Free' },
      ]);
    });

    it('should list two routes to Sandy Bay for Devon Cliffs, each with the same beach', async () => {
      const [devonCliffs] = await (await get('/api/projections/Parks%20(Detailed)/v1?changeSetId=8&code=DC')).json();
      deq(devonCliffs.beach_routes.map(({ name, accessibility }: any) => `${name} (${accessibility})`), ['Along the beach road (Step Free)', 'Via the cliff path (Steep Steps)']);
      deq(devonCliffs.beach_routes.map((route: any) => route.beach), [{ name: 'Sandy Bay', surfaces: '{Sandy,Rocky}' }, { name: 'Sandy Bay', surfaces: '{Sandy,Rocky}' }]);
    });

    it('should keep the beach when the park that reached it is sold', async () => {
      const [greenacres] = await (await get('/api/projections/Parks%20(Minimal)/v1?changeSetId=7&code=GA')).json();
      deq(greenacres.beach_routes, [{ beach_code: 'BLACK_ROCK_SANDS', name: 'Across the dunes', distance_metres: 300, accessibility: 'Step Free' }]);
      deq(await (await get('/api/projections/Beaches/v1?changeSetId=8&code=BLACK_ROCK_SANDS')).json(), [{ code: 'BLACK_ROCK_SANDS', name: 'Black Rock Sands', surfaces: '{Sandy}' }]);
    });
  });

  describe('What a Gold van is', () => {
    it('should respond with the grades in rank order, each with its attributes and the models that hold it', async () => {
      const response = await get('/api/projections/Grades/v1?changeSetId=5');
      eq(response.status, 200);
      const grades = await response.json();
      deq(grades.map((grade: any) => grade.code), ['Platinum', 'Gold', 'Silver', 'Bronze', 'Saver']);

      const [platinum, gold, , , saver] = grades;
      deq(platinum.attributes.map((attribute: any) => attribute.attribute), ['Double Glazing', 'Central Heating', 'Decking', 'Dishwasher', 'En Suite', 'Patio Doors', 'Integrated Appliances']);
      deq(platinum.models, [{ model_code: 'CLW', year: 2025 }, { model_code: 'CLW', year: 2026 }, { model_code: 'HEL', year: 2025 }, { model_code: 'HEL', year: 2026 }]);
      deq(gold.attributes.map((attribute: any) => attribute.attribute), ['Double Glazing', 'Central Heating', 'Decking', 'En Suite', 'Patio Doors']);
      deq(gold.models.map(({ model_code, year }: any) => `${model_code} ${year}`), ['AVO 2025', 'AVO 2026', 'CAS 2025', 'CAS 2026', 'RIO 2025', 'RIO 2026']);
      deq(saver, { code: 'Saver', models: [{ model_code: 'CHA', year: 2025 }, { model_code: 'CHA', year: 2026 }, { model_code: 'VER', year: 2025 }, { model_code: 'VER', year: 2026 }], attributes: [] });
    });

    it('should filter the grades by code', async () => {
      const response = await get('/api/projections/Grades/v1?changeSetId=10&code=Silver');
      eq(response.status, 200);
      eq(response.headers.get('X-Total-Count'), '1');
      const [silver] = await response.json();
      deq(silver.models.map(({ model_code, year }: any) => `${model_code} ${year}`), ['AMB 2026', 'BEV 2025', 'BEV 2026', 'BEV 2027', 'LOI 2025', 'LOI 2026', 'LOI 2027']);
    });
  });

  describe('What an amenity is', () => {
    it('should redirect to the change set that loaded the amenities', async () => {
      const response = await get('/api/projections/Amenities/v1');
      eq(response.status, 307);
      eq(response.headers.get('Location'), '/api/projections/Amenities/v1?changeSetId=1');
    });

    it('should respond with the amenity', async () => {
      const response = await get('/api/projections/Amenities/v1?changeSetId=1&code=KIDS_CLUB');
      eq(response.status, 200);
      deq(await response.json(), [{ code: 'KIDS_CLUB', name: 'Kids Club', category: 'Entertainment', age_group: 'Children', charge: 'Free', vat_code: 'Family Attraction' }]);
    });

    it('should filter the amenities by a list of categories in name order', async () => {
      const response = await get('/api/projections/Amenities/v1?changeSetId=1&category=Pool&category=Nature');
      eq(response.status, 200);
      deq((await response.json()).map((amenity: any) => amenity.name), ['Indoor Pool', 'Nature Trail', 'Outdoor Pool', 'Splash Zone']);
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

    it('should respond with the manufacturers, their models, and each model\'s prices and accessories', async () => {
      const response = await get('/api/projections/Catalogue/v1?changeSetId=5');
      eq(response.status, 200);
      const manufacturers = await response.json();
      deq(manufacturers.map((manufacturer: any) => manufacturer.name), ['ABI', 'Atlas', 'Carnaby', 'Swift', 'Victory', 'Willerby']);

      const [ambleside, arizona, beverley] = manufacturers[0].models;
      eq(ambleside.name, 'ABI Ambleside');
      deq(ambleside.prices, [{ year: 2026, list_price: '22995.00' }]);
      deq(ambleside.accessories, [{ code: 'AMB-DEC', name: 'Decking', price: '3995.00' }, { code: 'AMB-VER', name: 'Veranda', price: '2495.00' }]);

      eq(arizona.name, 'ABI Arizona');
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
      const [richmond] = await (await get('/api/projections/Parks%20(Minimal)/v1?changeSetId=5&code=RI')).json();
      eq(richmond.name, 'Richmond');
      const [skegness] = await (await get('/api/projections/Parks%20(Minimal)/v1?changeSetId=6&code=RI')).json();
      eq(skegness.name, 'Skegness');
      deq(skegness.amenities, richmond.amenities);

      const before = await get('/api/projections/Parks%20(Minimal)/v1?changeSetId=7');
      eq(before.headers.get('X-Total-Count'), '10');
      const after = await get('/api/projections/Parks%20(Minimal)/v1?changeSetId=8');
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

  for (const projection of ['Parks (Minimal)', 'Parks (Detailed)']) {
    describe(`GET /api/projections/${encodeURIComponent(projection)}/v1`, () => {
      it('should filter the parks by the start of their name', async () => {
        const response = await get(`/api/projections/${encodeURIComponent(projection)}/v1?changeSetId=1&name=G`);
        eq(response.status, 200);
        deq((await response.json()).map((park: any) => park.name), ['Golden Sands', 'Greenacres']);
      });

      it('should filter the parks by a list of regions', async () => {
        const response = await get(`/api/projections/${encodeURIComponent(projection)}/v1?changeSetId=1&region=Scotland&region=Wales`);
        eq(response.status, 200);
        deq((await response.json()).map((park: any) => park.name), ['Craig Tara', 'Greenacres', 'Kiln Park']);
      });

      it('should page the parks', async () => {
        const response = await get(`/api/projections/${encodeURIComponent(projection)}/v1?changeSetId=8&page=2&pageSize=4`);
        eq(response.status, 200);
        eq(response.headers.get('X-Total-Count'), '9');
        eq(response.headers.get('Link'), `</api/projections/${encodeURIComponent(projection)}/v1?changeSetId=8&page=1&pageSize=4>; rel="prev", </api/projections/${encodeURIComponent(projection)}/v1?changeSetId=8&page=3&pageSize=4>; rel="next"`);
        deq((await response.json()).map((park: any) => park.name), ['Kiln Park', 'Primrose Valley', 'Rockley Park', 'Seashore']);
      });
    });
  }

  describe('GET /api/openapi.json', () => {
    it('should describe the projections', async () => {
      const response = await get('/api/openapi.json');
      eq(response.status, 200);
      const document = await response.json();
      eq(document.info.title, 'Holiday Park Data Service');
      deq(Object.keys(document.paths), ['/projections', '/changelog', '/projections/Amenities/v1', '/projections/Beaches/v1', '/projections/Catalogue/v1', '/projections/Grades/v1', '/projections/Models/v1', '/projections/Parks%20(Detailed)/v1', '/projections/Parks%20(Minimal)/v1', '/projections/VAT%20Rates/v1']);

      const parks = schema(document, 'Parks (Minimal)');
      deq(parks.properties.region, { type: 'string', enum: ['Scotland', 'North East', 'Yorkshire', 'North West', 'Wales', 'Midlands', 'East', 'South East', 'South West'] });
      deq(parks.properties.seasons.items.properties.current_season_start, { type: 'string', format: 'date-time' });
      deq(parks.properties.seasons.items.properties.next_season_start, { type: ['string', 'null'], format: 'date-time' });
      deq(Object.keys(parks.properties.amenities.items.properties), ['amenity_code']);
      deq(Object.keys(parks.properties.beach_routes.items.properties), ['beach_code', 'name', 'distance_metres', 'accessibility']);
      deq(parks.properties.beach_routes.items.properties.accessibility, { type: 'string', enum: ['Step Free', 'Steps', 'Steep Steps'] });

      const detailed = schema(document, 'Parks (Detailed)');
      deq(document.paths['/projections/Parks%20(Detailed)/v1'].get.parameters.map((parameter: any) => parameter.name), ['changeSetId', 'code', 'name', 'region', 'page', 'pageSize']);
      deq(Object.keys(detailed.properties.amenities.items.properties), ['amenity_code', 'amenity']);
      deq(detailed.properties.amenities.items.required, ['amenity_code', 'amenity']);
      const [amenity, amenityNull] = detailed.properties.amenities.items.properties.amenity.anyOf;
      deq(amenityNull, { type: 'null' });
      deq(amenity.required, ['name', 'category', 'age_group', 'charge', 'vat_code']);
      deq(amenity.properties.age_group, { type: 'string', enum: ['All Ages', 'Children', 'Adults'] });
      deq(Object.keys(detailed.properties.beach_routes.items.properties), ['beach_code', 'name', 'distance_metres', 'accessibility', 'beach']);
      const [beach, beachNull] = detailed.properties.beach_routes.items.properties.beach.anyOf;
      deq(beachNull, { type: 'null' });
      deq(Object.keys(beach.properties), ['name', 'surfaces']);
      deq(beach.properties.surfaces, { type: 'array', items: { type: 'string', enum: ['Sandy', 'Shingle', 'Pebbles', 'Rocky'] } });

      const beaches = schema(document, 'Beaches');
      deq(document.paths['/projections/Beaches/v1'].get.parameters.map((parameter: any) => parameter.name), ['changeSetId', 'code']);
      deq(beaches.required, ['code', 'name', 'surfaces']);

      const grades = schema(document, 'Grades');
      deq(grades.properties.code, { type: 'string', enum: ['Platinum', 'Gold', 'Silver', 'Bronze', 'Saver'] });
      deq(grades.required, ['code', 'models', 'attributes']);
      deq(grades.properties.models.items.required, ['model_code', 'year']);
      deq(grades.properties.attributes.items.properties.attribute, { type: 'string', enum: ['Double Glazing', 'Central Heating', 'Decking', 'Dishwasher', 'En Suite', 'Patio Doors', 'Integrated Appliances'] });

      const amenities = schema(document, 'Amenities');
      deq(amenities.required, ['code', 'name', 'category', 'age_group', 'charge', 'vat_code']);
      deq(amenities.properties.charge, { type: 'string', enum: ['Free', 'Paid'] });

      const models = schema(document, 'Models');
      deq(models.properties.berths, { type: 'integer' });
      deq(models.properties.length, { type: 'string' });
      deq(models.properties.double_glazed, { type: 'boolean' });
      deq(models.required, ['code', 'manufacturer_code', 'name', 'berths', 'bedrooms', 'length', 'width', 'heating', 'double_glazed', 'vat_code', 'prices', 'accessories']);

      const catalogue = schema(document, 'Catalogue');
      deq(Object.keys(catalogue.properties.models.items.properties), ['code', 'name', 'berths', 'bedrooms', 'length', 'width', 'heating', 'double_glazed', 'vat_code', 'prices', 'accessories']);
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

  function get(path: string) {
    return application.app.request(path);
  }
});
