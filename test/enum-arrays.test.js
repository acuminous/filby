const { deepStrictEqual: deq } = require('node:assert');
const { describe, it, before, after } = require('node:test');

const TestFilby = require('./TestFilby');

const config = {
  nukeCustomObjects: async (tx) => {
    await tx.query('DROP FUNCTION IF EXISTS get_amenities_v1');
    await tx.query('DROP TABLE IF EXISTS amenity_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_amenity_v1_aggregate');
    await tx.query('DROP TYPE IF EXISTS amenity_category');
  },
};

const ADD_AMENITIES = `
- operation: ADD_ENUM
  name: Amenity Category
  values:
    - Pool
    - Entertainment
    - Dining
- operation: ADD_ENTITY
  name: Amenity
  version: 1
  fields:
    - name: name
      type: TEXT
    - name: categories
      type: Amenity Category[]
  identified_by:
    - name
- operation: ADD_PROJECTION
  name: Amenities
  version: 1
  root: Amenity@1
- operation: ADD_CHANGE_SET
  description: 2020 Amenities
  effective: 2020-01-01T00:00:00.000Z
  frames:
    - entity: Amenity
      version: 1
      action: POST
      data:
        - name: Splash Zone
          categories: '{"Pool","Entertainment"}'
`;

describe('Enum arrays', () => {

  let migrator;
  let serving;

  before(async () => {
    migrator = new TestFilby(config);
    await migrator.reset();
    serving = new TestFilby(config);
    await serving.init();
  });

  after(async () => {
    await migrator.wipe();
    await migrator.stop();
    await serving.stop();
  });

  it('parses arrays of an enum added by another instance after this one started', async () => {
    await migrator.applyYaml('add amenities', ADD_AMENITIES);

    const projection = await serving.getProjection('Amenities', 1);
    const changeSet = await serving.getCurrentChangeSet(projection);

    const { documents } = await serving.getDocuments(projection, changeSet.id);
    deq(documents.map(({ name, categories }) => ({ name, categories })), [{ name: 'Splash Zone', categories: ['Pool', 'Entertainment'] }]);

    const aggregates = await serving.getAggregates(changeSet.id, 'Amenity', 1);
    deq(aggregates.map(({ categories }) => categories), [['Pool', 'Entertainment']]);
  });
});
