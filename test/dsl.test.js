const fs = require('node:fs');
const path = require('node:path');
const { ok, strictEqual: eq, deepEqual: deq, rejects, match } = require('node:assert');
const { describe, it, before, beforeEach, after, afterEach } = require('zunit');
const YAML = require('yaml');
const op = require('object-path-immutable');

const { tableName, aggregateFunctionName } = require('../lib/helpers');
const TestFilby = require('./TestFilby');

const config = {
  migrations: 'test/dsl',
  database: {
    user: 'fby_test',
    password: 'fby_test',
  },
  notifications: {
    initialDelay: '0ms',
    interval: '100ms',
    maxAttempts: 3,
    maxRescheduleDelay: '100ms',
  },
  nukeCustomObjects: async (tx) => {
    await tx.query('DROP TABLE IF EXISTS vat_rate_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_vat_rate_v1_aggregate');
    await tx.query('DROP TABLE IF EXISTS vat_rate_v2');
    await tx.query('DROP FUNCTION IF EXISTS get_vat_rate_v2_aggregate');
    await tx.query('DROP TABLE IF EXISTS cgt_rate_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_cgt_rate_v1_aggregate');
    await tx.query('DROP TYPE IF EXISTS vat_tax_rate');
    await tx.query('DROP TYPE IF EXISTS cgt_tax_rate');
  },
};

describe('DSL', () => {

  let filby;

  before(async () => {
    deleteMigrations();
    filby = new TestFilby(config);
    await filby.reset();
  });

  beforeEach(async () => {
    deleteMigrations();
    await filby.wipe();
  });

  after(async () => {
    await filby.stop();
  });

  describe('General Validation', () => {
    it('should report unknown terms', async (t) => {
      await rejects(applyYaml(t.name, `
        - operation: WOMBAT
      `), (err) => {
        eq(err.message, "001.should-report-unknown-terms.yaml: /0/operation must be equal to one of the allowed values 'ADD_ENUM', 'ADD_ENTITY', 'ADD_PROJECTION', 'ADD_HOOK', 'ADD_CHANGE_SET', 'DROP_ENUM', 'DROP_ENTITY', 'DROP_PROJECTION' or 'DROP_HOOK'");
        return true;
      });
    });

    it('should report invalid operation type', async (t) => {
      await rejects(applyYaml(t.name, `
        - operation: 1
      `), (err) => {
        eq(err.message, "001.should-report-invalid-operation-type.yaml: /0/operation must be of type 'string'");
        return true;
      });
    });
  });

  describe('Add Enum', () => {

    const ADD_ENUM = `
      - operation: ADD_ENUM
        name: vat_tax_rate
        values:
          - standard
          - reduced
          - zero
    `;

    it('should add enum', async (t) => {
      await applyYaml(t.name, ADD_ENUM);

      const { rows: labels } = await filby.withTransaction((tx) => tx.query("SELECT enumlabel AS label FROM pg_enum WHERE enumtypid = 'vat_tax_rate'::regtype"));
      eq(labels.length, 3);
      deq(labels[0], { label: 'standard' });
      deq(labels[1], { label: 'reduced' });
      deq(labels[2], { label: 'zero' });
    });

    it('should reject duplicate enum', async (t) => {
      await applyYaml(t.name, ADD_ENUM);
      await rejects(() => applyYaml(t.name, ADD_ENUM), (err) => {
        eq(err.message, "Enum 'vat_tax_rate' already exists");
        return true;
      });
    });

    it('should require a name', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_ENUM).del('0.name'),
      ), (err) => {
        eq(err.message, "001.should-require-a-name.yaml: /0 must have required property 'name'");
        return true;
      });
    });

    it('should require name to be a string', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_ENUM).set('0.name', 1),
      ), (err) => {
        eq(err.message, "001.should-require-name-to-be-a-string.yaml: /0/name must be of type 'string'");
        return true;
      });
    });

    it('should require at least one value', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_ENUM).del('0.values'),
      ), (err) => {
        eq(err.message, "001.should-require-at-least-one-value.yaml: /0 must have required property 'values'");
        return true;
      });

      await rejects(() => applyYaml(
        t.name,
        transform(ADD_ENUM).set('0.values', 1),
      ), (err) => {
        eq(err.message, "001.should-require-at-least-one-value.yaml: /0/values must be of type 'array'");
        return true;
      });

      await rejects(() => applyYaml(
        t.name,
        transform(ADD_ENUM).set('0.values', []),
      ), (err) => {
        eq(err.message, '001.should-require-at-least-one-value.yaml: /0/values must NOT have fewer than 1 items');
        return true;
      });
    });

    it('should require values to be strings', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_ENUM).set('0.values.0', 1),
      ), (err) => {
        eq(err.message, "001.should-require-values-to-be-strings.yaml: /0/values/0 must be of type 'string'");
        return true;
      });
    });

    it('should forbid additional properties', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_ENUM).merge('0', { wombat: 1 }),
      ), (err) => {
        eq(err.message, "001.should-forbid-additional-properties.yaml: /0 must NOT have additional property 'wombat'");
        return true;
      });
    });
  });

  describe('Drop Enum', () => {

    const DROP_ENUM = `
      - operation: ADD_ENUM
        name: vat_tax_rate
        values:
          - standard
          - reduced
          - zero

      - operation: DROP_ENUM
        name: vat_tax_rate
    `;
    it('should drop enum', async (t) => {
      await applyYaml(t.name, DROP_ENUM);

      const { rows: enums } = await filby.withTransaction((tx) => tx.query("SELECT * FROM pg_type WHERE typname LIKE '%_tax_rate' AND typtype = 'e'"));
      eq(enums.length, 0);
    });

    it('should ignore other enums', async (t) => {
      await applyYaml(
        t.name,
        transform(DROP_ENUM).insert('', {
          operation: 'ADD_ENUM',
          name: 'cgt_tax_rate',
          values: [
            'residential_property',
            'commercial_property',
          ],
        }, 0),
      );

      const { rows: enums } = await filby.withTransaction((tx) => tx.query("SELECT * FROM pg_type WHERE typname LIKE '%_tax_rate' AND typtype = 'e'"));
      eq(enums.length, 1);
    });

    it('should require a name', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(DROP_ENUM).del('1.name'),
      ), (err) => {
        eq(err.message, "001.should-require-a-name.yaml: /1 must have required property 'name'");
        return true;
      });
    });

    it('should require name to be a string', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(DROP_ENUM).set('1.name', 1),
      ), (err) => {
        eq(err.message, "001.should-require-name-to-be-a-string.yaml: /1/name must be of type 'string'");
        return true;
      });
    });

    it('should forbid additional properties', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(DROP_ENUM).merge('1', { wombat: 1 }),
      ), (err) => {
        eq(err.message, "001.should-forbid-additional-properties.yaml: /1 must NOT have additional property 'wombat'");
        return true;
      });
    });

    it('should report missing enums', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(DROP_ENUM).del('0'),
      ), (err) => {
        eq(err.message, "Enum 'vat_tax_rate' does not exist");
        return true;
      });
    });
  });

  describe('Add Entity', () => {

    const ADD_ENTITY = `
      - operation: ADD_ENTITY
        name: VAT Rate
        version: 1
        fields:
        - name: type
          type: TEXT
        - name: rate
          type: NUMERIC
        identified_by:
        - type
    `;

    it('should add entity', async (t) => {
      await applyYaml(t.name, ADD_ENTITY);

      const { rows: entities } = await filby.withTransaction((tx) => tx.query('SELECT name, version FROM fby_entity'));
      eq(entities.length, 1);
      deq(entities[0], { name: 'VAT Rate', version: 1 });
    });

    it('should reject duplicate entity', async (t) => {
      await applyYaml(t.name, ADD_ENTITY);
      await rejects(() => applyYaml(t.name, ADD_ENTITY), (err) => {
        eq(err.message, "Entity 'VAT Rate v1' already exists");
        return true;
      });
    });

    it('should require a name', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_ENTITY).del('0.name'),
      ), (err) => {
        eq(err.message, "001.should-require-a-name.yaml: /0 must have required property 'name'");
        return true;
      });
    });

    it('should require name to be a string', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_ENTITY).set('0.name', 1),
      ), (err) => {
        eq(err.message, "001.should-require-name-to-be-a-string.yaml: /0/name must be of type 'string'");
        return true;
      });
    });

    it('should require a version', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_ENTITY).del('0.version'),
      ), (err) => {
        eq(err.message, "001.should-require-a-version.yaml: /0 must have required property 'version'");
        return true;
      });
    });

    it('should require version to be an integer', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_ENTITY).set('0.version', 1.1),
      ), (err) => {
        eq(err.message, "001.should-require-version-to-be-an-integer.yaml: /0/version must be of type 'integer'");
        return true;
      });
    });

    it('should require at least one field', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_ENTITY).del('0.fields'),
      ), (err) => {
        eq(err.message, "001.should-require-at-least-one-field.yaml: /0 must have required property 'fields'");
        return true;
      });

      await rejects(() => applyYaml(
        t.name,
        transform(ADD_ENTITY).set('0.fields', 1),
      ), (err) => {
        eq(err.message, "001.should-require-at-least-one-field.yaml: /0/fields must be of type 'array'");
        return true;
      });

      await rejects(() => applyYaml(
        t.name,
        transform(ADD_ENTITY).set('0.fields', []),
      ), (err) => {
        eq(err.message, '001.should-require-at-least-one-field.yaml: /0/fields must NOT have fewer than 1 items');
        return true;
      });
    });

    it('should require fields to have a name', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_ENTITY).del('0.fields.0.name'),
      ), (err) => {
        eq(err.message, "001.should-require-fields-to-have-a-name.yaml: /0/fields/0 must have required property 'name'");
        return true;
      });
    });

    it('should require field name to be a string', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_ENTITY).set('0.fields.0.name', 1),
      ), (err) => {
        eq(err.message, "001.should-require-field-name-to-be-a-string.yaml: /0/fields/0/name must be of type 'string'");
        return true;
      });
    });

    it('should require fields to have a type', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_ENTITY).del('0.fields.0.type'),
      ), (err) => {
        eq(err.message, "001.should-require-fields-to-have-a-type.yaml: /0/fields/0 must have required property 'type'");
        return true;
      });
    });

    it('should require field type to be a string', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_ENTITY).set('0.fields.0.type', 1),
      ), (err) => {
        eq(err.message, "001.should-require-field-type-to-be-a-string.yaml: /0/fields/0/type must be of type 'string'");
        return true;
      });
    });

    it('should reject invalid field types', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_ENTITY).set('0.fields.0.type', 'INVALID TYPE'),
      ), (err) => {
        eq(err.code, '42601');
        return true;
      });
    });

    it('should require at least one identifier column', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_ENTITY).del('0.identified_by'),
      ), (err) => {
        eq(err.message, "001.should-require-at-least-one-identifier-column.yaml: /0 must have required property 'identified_by'");
        return true;
      });

      await rejects(() => applyYaml(
        t.name,
        transform(ADD_ENTITY).set('0.identified_by', 1),
      ), (err) => {
        eq(err.message, "001.should-require-at-least-one-identifier-column.yaml: /0/identified_by must be of type 'array'");
        return true;
      });

      await rejects(() => applyYaml(
        t.name,
        transform(ADD_ENTITY).set('0.identified_by', []),
      ), (err) => {
        eq(err.message, '001.should-require-at-least-one-identifier-column.yaml: /0/identified_by must NOT have fewer than 1 items');
        return true;
      });
    });

    it('should forbid additional properties in fields', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_ENTITY).merge('0.fields.0', { wombat: 1 }),
      ), (err) => {
        eq(err.message, "001.should-forbid-additional-properties-in-fields.yaml: /0/fields/0 must NOT have additional property 'wombat'");
        return true;
      });
    });

    it('should forbid additional properties', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_ENTITY).merge('0', { wombat: 1 }),
      ), (err) => {
        eq(err.message, "001.should-forbid-additional-properties.yaml: /0 must NOT have additional property 'wombat'");
        return true;
      });
    });
  });

  describe('Drop Entity', () => {

    const DROP_ENTITY = `
      - operation: ADD_ENTITY
        name: VAT Rate
        version: 1
        fields:
        - name: type
          type: TEXT
        - name: rate
          type: NUMERIC
        identified_by:
        - type

      - operation: DROP_ENTITY
        name: VAT Rate
        version: 1
    `;

    it('should drop entity', async (t) => {
      await applyYaml(t.name, DROP_ENTITY);

      const { rows: entities } = await filby.withTransaction((tx) => tx.query('SELECT * FROM fby_entity'));
      eq(entities.length, 0);

      const { rows: tables } = await filby.withTransaction((tx) => tx.query('SELECT * FROM information_schema.tables WHERE table_name = $1', [tableName('vat_rate', 1)]));
      eq(tables.length, 0);

      const { rows: functions } = await filby.withTransaction((tx) => tx.query('SELECT * FROM pg_proc WHERE proname = $1', [aggregateFunctionName('vat_rate', 1)]));
      eq(functions.length, 0);
    });

    it('should ignore other entities', async (t) => {
      await applyYaml(
        t.name,
        transform(DROP_ENTITY).insert('', {
          operation: 'ADD_ENTITY',
          name: 'VAT Rate',
          version: 2,
          fields: [
            {
              name: 'type',
              type: 'TEXT',
            },
            {
              name: 'rate',
              type: 'DECIMAL',
            },
          ],
          identified_by: [
            'type',
          ],
        }, 2),
      );

      const { rows: entities } = await filby.withTransaction((tx) => tx.query('SELECT * FROM fby_entity'));
      eq(entities.length, 1);

      const { rows: tables } = await filby.withTransaction((tx) => tx.query('SELECT * FROM information_schema.tables WHERE table_name = $1', [tableName('vat_rate', 2)]));
      eq(tables.length, 1);

      const { rows: functions } = await filby.withTransaction((tx) => tx.query('SELECT * FROM pg_proc WHERE proname = $1', [aggregateFunctionName('vat_rate', 2)]));
      eq(functions.length, 1);
    });

    it('should require a name', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(DROP_ENTITY).del('1.name'),
      ), (err) => {
        eq(err.message, "001.should-require-a-name.yaml: /1 must have required property 'name'");
        return true;
      });
    });

    it('should require name to be a string', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(DROP_ENTITY).set('1.name', 1),
      ), (err) => {
        eq(err.message, "001.should-require-name-to-be-a-string.yaml: /1/name must be of type 'string'");
        return true;
      });
    });

    it('should require a version', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(DROP_ENTITY).del('1.version'),
      ), (err) => {
        eq(err.message, "001.should-require-a-version.yaml: /1 must have required property 'version'");
        return true;
      });
    });

    it('should require version to be a string', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(DROP_ENTITY).set('1.version', 'meh'),
      ), (err) => {
        eq(err.message, "001.should-require-version-to-be-a-string.yaml: /1/version must be of type 'integer'");
        return true;
      });
    });

    it('should forbid additional properties', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(DROP_ENTITY).merge('1', { wombat: 1 }),
      ), (err) => {
        eq(err.message, "001.should-forbid-additional-properties.yaml: /1 must NOT have additional property 'wombat'");
        return true;
      });
    });

    it('should report missing entities', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(DROP_ENTITY).del('0'),
      ), (err) => {
        eq(err.message, "Entity 'VAT Rate v1' does not exist");
        return true;
      });
    });
  });

  describe('Add Projection', () => {

    const ADD_PROJECTION = `
      - operation: ADD_ENTITY
        name: VAT Rate
        version: 1
        fields:
        - name: type
          type: TEXT
        - name: rate
          type: NUMERIC
        identified_by:
        - type

      - operation: ADD_PROJECTION
        name: VAT Rates
        version: 1
        dependencies:
        - entity: VAT Rate
          version: 1
      `;

    it('should add projection', async (t) => {
      await applyYaml(t.name, ADD_PROJECTION);
      const { rows: projections } = await filby.withTransaction((tx) => tx.query('SELECT name, version FROM fby_projection'));

      eq(projections.length, 1);
      deq(projections[0], { name: 'VAT Rates', version: 1 });
    });

    it('should reject duplicate projection', async (t) => {
      await applyYaml(t.name, ADD_PROJECTION);
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_PROJECTION).del('0'),
      ), (err) => {
        eq(err.message, "Projection 'VAT Rates v1' already exists");
        return true;
      });
    });

    it('should require a name', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_PROJECTION).del('1.name'),
      ), (err) => {
        eq(err.message, "001.should-require-a-name.yaml: /1 must have required property 'name'");
        return true;
      });
    });

    it('should require name to be a string', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_PROJECTION).set('1.name', 1),
      ), (err) => {
        eq(err.message, "001.should-require-name-to-be-a-string.yaml: /1/name must be of type 'string'");
        return true;
      });
    });

    it('should require a version', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_PROJECTION).del('1.version'),
      ), (err) => {
        eq(err.message, "001.should-require-a-version.yaml: /1 must have required property 'version'");
        return true;
      });
    });

    it('should require version to be an integer', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_PROJECTION).set('1.version', 1.1),
      ), (err) => {
        eq(err.message, "001.should-require-version-to-be-an-integer.yaml: /1/version must be of type 'integer'");
        return true;
      });
    });

    it('should require at least one dependency', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_PROJECTION).del('1.dependencies'),
      ), (err) => {
        eq(err.message, "001.should-require-at-least-one-dependency.yaml: /1 must have required property 'dependencies'");
        return true;
      });

      await rejects(() => applyYaml(
        t.name,
        transform(ADD_PROJECTION).set('1.dependencies', 1),
      ), (err) => {
        eq(err.message, "001.should-require-at-least-one-dependency.yaml: /1/dependencies must be of type 'array'");
        return true;
      });

      await rejects(() => applyYaml(
        t.name,
        transform(ADD_PROJECTION).set('1.dependencies', []),
      ), (err) => {
        eq(err.message, '001.should-require-at-least-one-dependency.yaml: /1/dependencies must NOT have fewer than 1 items');
        return true;
      });
    });

    it('should require dependencies to have an entity', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_PROJECTION).del('1.dependencies.0.entity'),
      ), (err) => {
        eq(err.message, "001.should-require-dependencies-to-have-an-entity.yaml: /1/dependencies/0 must have required property 'entity'");
        return true;
      });
    });

    it('should require dependency entity to be a string', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_PROJECTION).set('1.dependencies.0.entity', 1),
      ), (err) => {
        eq(err.message, "001.should-require-dependency-entity-to-be-a-string.yaml: /1/dependencies/0/entity must be of type 'string'");
        return true;
      });
    });

    it('should require dependencies to have a version', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_PROJECTION).del('1.dependencies.0.version'),
      ), (err) => {
        eq(err.message, "001.should-require-dependencies-to-have-a-version.yaml: /1/dependencies/0 must have required property 'version'");
        return true;
      });
    });

    it('should require dependencies version to be an integer', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_PROJECTION).set('1.dependencies.0.version', 1.1),
      ), (err) => {
        eq(err.message, "001.should-require-dependencies-version-to-be-an-integer.yaml: /1/dependencies/0/version must be of type 'integer'");
        return true;
      });
    });

    it('should forbid additional properties in dependencies', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_PROJECTION).merge('1.dependencies.0', { wombat: 1 }),
      ), (err) => {
        eq(err.message, "001.should-forbid-additional-properties-in-dependencies.yaml: /1/dependencies/0 must NOT have additional property 'wombat'");
        return true;
      });
    });

    it('should forbid additional properties', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_PROJECTION).merge('1', { wombat: 1 }),
      ), (err) => {
        eq(err.message, "001.should-forbid-additional-properties.yaml: /1 must NOT have additional property 'wombat'");
        return true;
      });
    });
  });

  describe('Drop Projection', () => {

    const DROP_PROJECTION = `
      - operation: ADD_ENTITY
        name: VAT Rate
        version: 1
        fields:
        - name: type
          type: TEXT
        - name: rate
          type: NUMERIC
        identified_by:
        - type

      - operation: ADD_PROJECTION
        name: VAT Rates
        version: 1
        dependencies:
        - entity: VAT Rate
          version: 1

      - operation: DROP_PROJECTION
        name: VAT Rates
        version: 1
    `;

    it('should drop projection', async (t) => {
      await applyYaml(t.name, DROP_PROJECTION);
      const { rows: projections } = await filby.withTransaction((tx) => tx.query('SELECT * FROM fby_projection'));
      eq(projections.length, 0);
    });

    it('should ignore other projections', async (t) => {
      await applyYaml(
        t.name,
        transform(DROP_PROJECTION).insert('', {
          operation: 'ADD_PROJECTION',
          name: 'VAT Rates',
          version: 2,
          dependencies: [
            {
              entity: 'VAT Rate',
              version: 1,
            },
          ],
        }, 2),
      );
      const { rows: projections } = await filby.withTransaction((tx) => tx.query('SELECT * FROM fby_projection'));
      eq(projections.length, 1);
    });

    it('should require a name', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(DROP_PROJECTION).del('2.name'),
      ), (err) => {
        eq(err.message, "001.should-require-a-name.yaml: /2 must have required property 'name'");
        return true;
      });
    });

    it('should require name to be a string', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(DROP_PROJECTION).set('2.name', 1),
      ), (err) => {
        eq(err.message, "001.should-require-name-to-be-a-string.yaml: /2/name must be of type 'string'");
        return true;
      });
    });

    it('should require a version', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(DROP_PROJECTION).del('2.version'),
      ), (err) => {
        eq(err.message, "001.should-require-a-version.yaml: /2 must have required property 'version'");
        return true;
      });
    });

    it('should require version to be an integer', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(DROP_PROJECTION).set('2.version', 1.1),
      ), (err) => {
        eq(err.message, "001.should-require-version-to-be-an-integer.yaml: /2/version must be of type 'integer'");
        return true;
      });
    });

    it('should report missing projections', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(DROP_PROJECTION).del('1'),
      ), (err) => {
        eq(err.message, "Projection 'VAT Rates v1' does not exist");
        return true;
      });
    });

    it('should forbid additional properties', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(DROP_PROJECTION).merge('2', { wombat: 1 }),
      ), (err) => {
        eq(err.message, "001.should-forbid-additional-properties.yaml: /2 must NOT have additional property 'wombat'");
        return true;
      });
    });
  });

  describe('Add Change Set', () => {

    const ADD_CHANGE_SET = `
      - operation: ADD_ENTITY
        name: VAT Rate
        version: 1
        fields:
        - name: type
          type: TEXT
        - name: rate
          type: NUMERIC
        identified_by:
        - type

      - operation: ADD_CHANGE_SET
        description: 2020 VAT Rates
        effective: 2020-04-05T00:00:00.000Z
        frames:
        - entity: VAT Rate
          version: 1
          action: POST
          data:
          - type: standard
            rate: 0.10
        - entity: VAT Rate
          version: 1
          action: POST
          data:
          - type: reduced
            rate: 0.05
        - entity: VAT Rate
          version: 1
          action: POST
          data:
          - type: zero
            rate: 0
    `;

    it('should add a change set', async (t) => {
      await applyYaml(t.name, ADD_CHANGE_SET);

      const { rows } = await filby.withTransaction((tx) => tx.query(`
        SELECT c.description, c.effective, e.name AS entity, e.version, f.action, v.type, v.rate
        FROM fby_change_set c
        INNER JOIN fby_data_frame f ON f.change_set_id = c.id
        INNER JOIN fby_entity e ON f.entity_id = e.id
        INNER JOIN vat_rate_v1 v ON v.fby_frame_id = f.id
        ORDER BY v.type ASC`));
      eq(rows.length, 3);
      deq(rows[0], {
        description: '2020 VAT Rates',
        effective: new Date('2020-04-05T00:00:00.000Z'),
        entity: 'VAT Rate',
        version: 1,
        action: 'POST',
        type: 'reduced',
        rate: 0.05,
      });
    });

    it('should require a description', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_CHANGE_SET).del('1.description'),
      ), (err) => {
        eq(err.message, "001.should-require-a-description.yaml: /1 must have required property 'description'");
        return true;
      });
    });

    it('should require description to be a string', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_CHANGE_SET).set('1.description', 1),
      ), (err) => {
        eq(err.message, "001.should-require-description-to-be-a-string.yaml: /1/description must be of type 'string'");
        return true;
      });
    });

    it('should require an effective date', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_CHANGE_SET).del('1.effective'),
      ), (err) => {
        eq(err.message, "001.should-require-an-effective-date.yaml: /1 must have required property 'effective'");
        return true;
      });
    });

    it('should require effective to be a string', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_CHANGE_SET).set('1.effective', 1),
      ), (err) => {
        eq(err.message, "001.should-require-effective-to-be-a-string.yaml: /1/effective must be of type 'string'");
        return true;
      });
    });

    it('should require effective to be an ISO Date', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_CHANGE_SET).set('1.effective', 'wombat'),
      ), (err) => {
        eq(err.message, "001.should-require-effective-to-be-an-iso-date.yaml: /1/effective must match format 'date-time'");
        return true;
      });
    });

    it('should require at least one frame', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_CHANGE_SET).del('1.frames'),
      ), (err) => {
        eq(err.message, "001.should-require-at-least-one-frame.yaml: /1 must have required property 'frames'");
        return true;
      });

      await rejects(() => applyYaml(
        t.name,
        transform(ADD_CHANGE_SET).set('1.frames', 1),
      ), (err) => {
        eq(err.message, "001.should-require-at-least-one-frame.yaml: /1/frames must be of type 'array'");
        return true;
      });

      await rejects(() => applyYaml(
        t.name,
        transform(ADD_CHANGE_SET).set('1.frames', []),
      ), (err) => {
        eq(err.message, '001.should-require-at-least-one-frame.yaml: /1/frames must NOT have fewer than 1 items');
        return true;
      });
    });

    it('should require frames to specify an entity name', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_CHANGE_SET).del('1.frames.0.entity'),
      ), (err) => {
        eq(err.message, "001.should-require-frames-to-specify-an-entity-name.yaml: /1/frames/0 must have required property 'entity'");
        return true;
      });
    });

    it('should require frame entity name to be a string', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_CHANGE_SET).set('1.frames.0.entity', 1),
      ), (err) => {
        eq(err.message, "001.should-require-frame-entity-name-to-be-a-string.yaml: /1/frames/0/entity must be of type 'string'");
        return true;
      });
    });

    it('should require frames to specify an entity version', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_CHANGE_SET).del('1.frames.0.version'),
      ), (err) => {
        eq(err.message, "001.should-require-frames-to-specify-an-entity-version.yaml: /1/frames/0 must have required property 'version'");
        return true;
      });
    });

    it('should require frame entity version to be an integer', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_CHANGE_SET).set('1.frames.0.version', 'wombat'),
      ), (err) => {
        eq(err.message, "001.should-require-frame-entity-version-to-be-an-integer.yaml: /1/frames/0/version must be of type 'integer'");
        return true;
      });
    });

    it('should require frames to specify either an action or a source', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_CHANGE_SET).del('1.frames.0.action'),
      ), (err) => {
        eq(err.message, "001.should-require-frames-to-specify-either-an-action-or-a-source.yaml: /1/frames/0 must have required property 'source' or 'action'");
        return true;
      });
    });

    it('should require frame action to be a string', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_CHANGE_SET).set('1.frames.0.action', 1),
      ), (err) => {
        eq(err.message, "001.should-require-frame-action-to-be-a-string.yaml: /1/frames/0/action must be of type 'string'");
        return true;
      });
    });

    it('should require frame action to be POST or DELETE', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_CHANGE_SET).set('1.frames.0.action', 'GET'),
      ), (err) => {
        eq(err.message, "001.should-require-frame-action-to-be-post-or-delete.yaml: /1/frames/0/action must be equal to one of the allowed values 'POST' or 'DELETE'");
        return true;
      });
    });

    it('should require frame data to specify at least one item', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_CHANGE_SET).del('1.frames.0.data'),
      ), (err) => {
        eq(err.message, "001.should-require-frame-data-to-specify-at-least-one-item.yaml: /1/frames/0 must have required property 'source' or 'data'");
        return true;
      });

      await rejects(() => applyYaml(
        t.name,
        transform(ADD_CHANGE_SET).set('1.frames.0.data', 1),
      ), (err) => {
        eq(err.message, "001.should-require-frame-data-to-specify-at-least-one-item.yaml: /1/frames/0/data must be of type 'array'");
        return true;
      });

      await rejects(() => applyYaml(
        t.name,
        transform(ADD_CHANGE_SET).set('1.frames.0.data', []),
      ), (err) => {
        eq(err.message, '001.should-require-frame-data-to-specify-at-least-one-item.yaml: /1/frames/0/data must NOT have fewer than 1 items');
        return true;
      });
    });

    it('should forbid additional properties in frames', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_CHANGE_SET).merge('1.frames.0', { wombat: 1 }),
      ), (err) => {
        eq(err.message, "001.should-forbid-additional-properties-in-frames.yaml: /1/frames/0 must NOT have additional property 'wombat'");
        return true;
      });
    });

    it('should forbid additional properties', async (t) => {
      await rejects(() => applyYaml(
        t.name,
        transform(ADD_CHANGE_SET).merge('1', { wombat: 1 }),
      ), (err) => {
        eq(err.message, "001.should-forbid-additional-properties.yaml: /1 must NOT have additional property 'wombat'");
        return true;
      });
    });
  });

  describe('Add Hook', () => {

    describe('ADD_CHANGE_SET [Projection Specific]', () => {
      const ADD_HOOK = `
        - operation: ADD_ENTITY
          name: VAT Rate
          version: 1
          fields:
          - name: type
            type: TEXT
          - name: rate
            type: NUMERIC
          identified_by:
          - type

        - operation: ADD_PROJECTION
          name: VAT Rates
          version: 1
          dependencies:
          - entity: VAT Rate
            version: 1

        - operation: ADD_HOOK
          name: sns/add-change-set/vat-rates-v1
          event: ADD_CHANGE_SET
          projection: VAT Rates
          version: 1
      `;

      it('should add hooks', async (t) => {
        await applyYaml(t.name, ADD_HOOK);

        const { rows: hooks } = await filby.withTransaction((tx) => tx.query(`
          SELECT h.name, h.event, p.name AS projection, version
          FROM fby_hook h
          LEFT JOIN fby_projection p ON h.projection_id = p.id
        `));

        eq(hooks.length, 1);
        deq(hooks[0], { name: 'sns/add-change-set/vat-rates-v1', event: 'ADD_CHANGE_SET', projection: 'VAT Rates', version: 1 });
      });

      it('should reject duplicate hook', async (t) => {
        await applyYaml(t.name, ADD_HOOK);
        await rejects(() => applyYaml(t.name, `
        - operation: ADD_HOOK
          name: sns/add-change-set/vat-rates-v1
          event: ADD_CHANGE_SET
          projection: VAT Rates
          version: 1
      `), (err) => {
          eq(err.message, "Hook 'sns/add-change-set/vat-rates-v1' already exists");
          return true;
        });
      });

      it('should require an event', async (t) => {
        await rejects(() => applyYaml(
          t.name,
          transform(ADD_HOOK).del('2.event'),
        ), (err) => {
          eq(err.message, "001.should-require-an-event.yaml: /2 must have required property 'event'");
          return true;
        });
      });

      it('should require event to be a string', async (t) => {
        await rejects(() => applyYaml(
          t.name,
          transform(ADD_HOOK).set('2.event', 1),
        ), (err) => {
          eq(err.message, "001.should-require-event-to-be-a-string.yaml: /2/event must be of type 'string'");
          return true;
        });
      });

      it('should require a projection', async (t) => {
        await rejects(() => applyYaml(
          t.name,
          transform(ADD_HOOK).del('2.projection'),
        ), (err) => {
          eq(err.message, "001.should-require-a-projection.yaml: /2 must have required property 'projection'");
          return true;
        });
      });

      it('should require projection to be a string', async (t) => {
        await rejects(() => applyYaml(
          t.name,
          transform(ADD_HOOK).set('2.projection', 1),
        ), (err) => {
          eq(err.message, "001.should-require-projection-to-be-a-string.yaml: /2/projection must be of type 'string'");
          return true;
        });
      });

      it('should require a version', async (t) => {
        await rejects(() => applyYaml(
          t.name,
          transform(ADD_HOOK).del('2.version'),
        ), (err) => {
          eq(err.message, "001.should-require-a-version.yaml: /2 must have required property 'version'");
          return true;
        });
      });

      it('should require version to be an integer', async (t) => {
        await rejects(() => applyYaml(
          t.name,
          transform(ADD_HOOK).set('2.version', 'wombat'),
        ), (err) => {
          eq(err.message, "001.should-require-version-to-be-an-integer.yaml: /2/version must be of type 'integer'");
          return true;
        });
      });

      it('should forbid additional properties', async (t) => {
        await rejects(() => applyYaml(
          t.name,
          transform(ADD_HOOK).merge('2', { wombat: 1 }),
        ), (err) => {
          eq(err.message, "001.should-forbid-additional-properties.yaml: /2 must NOT have additional property 'wombat'");
          return true;
        });
      });
    });

    describe('ADD_CHANGE_SET [General]', () => {

      const ADD_HOOK = `
      - operation: ADD_ENTITY
        name: VAT Rate
        version: 1
        fields:
        - name: type
          type: TEXT
        - name: rate
          type: NUMERIC
        identified_by:
        - type

      - operation: ADD_PROJECTION
        name: VAT Rates
        version: 1
        dependencies:
        - entity: VAT Rate
          version: 1

      - operation: ADD_HOOK
        name: sns/add-change-set/*
        event: ADD_CHANGE_SET
    `;

      it('should add hooks', async (t) => {
        await applyYaml(t.name, ADD_HOOK);

        const { rows: hooks } = await filby.withTransaction((tx) => tx.query(`
          SELECT h.name, h.event, p.name AS projection, version
          FROM fby_hook h
          LEFT JOIN fby_projection p ON h.projection_id = p.id
        `));

        eq(hooks.length, 1);
        deq(hooks[0], { name: 'sns/add-change-set/*', event: 'ADD_CHANGE_SET', projection: null, version: null });
      });

      it('should reject duplicate hook', async (t) => {
        await applyYaml(t.name, ADD_HOOK);
        await rejects(() => applyYaml(t.name, `
          - operation: ADD_HOOK
            name: sns/add-change-set/*
            event: ADD_CHANGE_SET
        `), (err) => {
          eq(err.message, "Hook 'sns/add-change-set/*' already exists");
          return true;
        });
      });

      it('should require an event', async (t) => {
        await rejects(() => applyYaml(
          t.name,
          transform(ADD_HOOK).del('2.event'),
        ), (err) => {
          eq(err.message, "001.should-require-an-event.yaml: /2 must have required property 'event'");
          return true;
        });
      });

      it('should require event to be a string', async (t) => {
        await rejects(() => applyYaml(
          t.name,
          transform(ADD_HOOK).set('2.event', 1),
        ), (err) => {
          eq(err.message, "001.should-require-event-to-be-a-string.yaml: /2/event must be of type 'string'");
          return true;
        });
      });

      it('should forbid additional properties', async (t) => {
        await rejects(() => applyYaml(
          t.name,
          transform(ADD_HOOK).merge('2', { wombat: 1 }),
        ), (err) => {
          eq(err.message, "001.should-forbid-additional-properties.yaml: /2 must NOT have additional property 'wombat'");
          return true;
        });
      });
    });
  });

  describe('Drop Hooks', () => {

    describe('ADD_CHANGE_SET [Projection Specific]', () => {

      const DROP_HOOK = `
      - operation: ADD_ENTITY
        name: VAT Rate
        version: 1
        fields:
        - name: type
          type: TEXT
        - name: rate
          type: NUMERIC
        identified_by:
        - type

      - operation: ADD_PROJECTION
        name: VAT Rates
        version: 1
        dependencies:
        - entity: VAT Rate
          version: 1

      - operation: ADD_HOOK
        name: sns/add-change-set/vat-rates-v1
        event: ADD_CHANGE_SET
        projection: VAT Rates
        version: 1

      - operation: DROP_HOOK
        name: sns/add-change-set/vat-rates-v1
    `;

      it('should drop hooks', async (t) => {
        await applyYaml(t.name, DROP_HOOK);
        const { rows: hooks } = await filby.withTransaction((tx) => tx.query('SELECT * FROM fby_hook'));
        eq(hooks.length, 0);
      });

      it('should ignore other hooks', async (t) => {
        await applyYaml(
          t.name,
          transform(DROP_HOOK).insert('', {
            operation: 'ADD_HOOK',
            name: 'httpbin/add-change-set/vat-rates-v1',
            event: 'ADD_CHANGE_SET',
            projection: 'VAT Rates',
            version: 1,
          }, 2),
        );

        const { rows: hooks } = await filby.withTransaction((tx) => tx.query('SELECT * FROM fby_hook'));
        eq(hooks.length, 1);
      });

      it('should require a name', async (t) => {
        await rejects(() => applyYaml(
          t.name,
          transform(DROP_HOOK).del('3.name'),
        ), (err) => {
          eq(err.message, "001.should-require-a-name.yaml: /3 must have required property 'name'");
          return true;
        });
      });

      it('should require name to be a string', async (t) => {
        await rejects(() => applyYaml(
          t.name,
          transform(DROP_HOOK).set('3.name', 1),
        ), (err) => {
          eq(err.message, "001.should-require-name-to-be-a-string.yaml: /3/name must be of type 'string'");
          return true;
        });
      });

      it('should forbid additional properties', async (t) => {
        await rejects(() => applyYaml(
          t.name,
          transform(DROP_HOOK).merge('3', { wombat: 1 }),
        ), (err) => {
          eq(err.message, "001.should-forbid-additional-properties.yaml: /3 must NOT have additional property 'wombat'");
          return true;
        });
      });

      it('should report missing specific projection hooks', async (t) => {
        await rejects(() => applyYaml(
          t.name,
          transform(DROP_HOOK).del('2'),
        ), (err) => {
          eq(err.message, "Hook 'sns/add-change-set/vat-rates-v1' does not exist");
          return true;
        });
      });
    });

    describe('ADD_CHANGE_SET [General]', () => {

      const DROP_HOOK = `
      - operation: ADD_ENTITY
        name: VAT Rate
        version: 1
        fields:
        - name: type
          type: TEXT
        - name: rate
          type: NUMERIC
        identified_by:
        - type

      - operation: ADD_PROJECTION
        name: VAT Rates
        version: 1
        dependencies:
        - entity: VAT Rate
          version: 1

      - operation: ADD_HOOK
        name: sns/add-change-set/vat-rates-v1
        event: ADD_CHANGE_SET

      - operation: DROP_HOOK
        name: sns/add-change-set/vat-rates-v1
    `;

      it('should drop hooks', async (t) => {
        await applyYaml(t.name, DROP_HOOK);
        const { rows: hooks } = await filby.withTransaction((tx) => tx.query('SELECT * FROM fby_hook'));
        eq(hooks.length, 0);
      });

      it('should ignore other hooks', async (t) => {
        await applyYaml(
          t.name,
          transform(DROP_HOOK).insert('', {
            operation: 'ADD_HOOK',
            name: 'httpbin/add-change-set/vat-rates-v1',
            event: 'ADD_CHANGE_SET',
            projection: 'VAT Rates',
            version: 1,
          }, 2),
        );

        const { rows: hooks } = await filby.withTransaction((tx) => tx.query('SELECT * FROM fby_hook'));
        eq(hooks.length, 1);
      });

      it('should require a name', async (t) => {
        await rejects(() => applyYaml(
          t.name,
          transform(DROP_HOOK).del('3.name'),
        ), (err) => {
          eq(err.message, "001.should-require-a-name.yaml: /3 must have required property 'name'");
          return true;
        });
      });

      it('should require name to be a string', async (t) => {
        await rejects(() => applyYaml(
          t.name,
          transform(DROP_HOOK).set('3.name', 1),
        ), (err) => {
          eq(err.message, "001.should-require-name-to-be-a-string.yaml: /3/name must be of type 'string'");
          return true;
        });
      });

      it('should forbid additional properties', async (t) => {
        await rejects(() => applyYaml(
          t.name,
          transform(DROP_HOOK).merge('3', { wombat: 1 }),
        ), (err) => {
          eq(err.message, "001.should-forbid-additional-properties.yaml: /3 must NOT have additional property 'wombat'");
          return true;
        });
      });

      it('should report missing specific projection hooks', async (t) => {
        await rejects(() => applyYaml(
          t.name,
          transform(DROP_HOOK).del('2'),
        ), (err) => {
          eq(err.message, "Hook 'sns/add-change-set/vat-rates-v1' does not exist");
          return true;
        });
      });
    });
  });

  describe('Aggregates', () => {

    const ADD_PROJECTION = `
      - operation: ADD_PROJECTION
        name: VAT Rates
        version: 1
        dependencies:
        - entity: VAT Rate
          version: 1
    `;

    const ADD_ENTITY = `
      - operation: ADD_ENTITY
        name: VAT Rate
        version: 1
        fields:
        - name: type
          type: TEXT
        - name: rate
          type: NUMERIC
        identified_by:
        - type
    `;
    const ADD_CHANGE_SET_1 = `
      - operation: ADD_CHANGE_SET
        description: 2020 VAT Rates
        effective: 2020-04-05T00:00:00.000Z
        frames:
        - entity: VAT Rate
          version: 1
          action: POST
          data:
          - type: standard
            rate: 0.10
        - entity: VAT Rate
          version: 1
          action: POST
          data:
          - type: reduced
            rate: 0.05
        - entity: VAT Rate
          version: 1
          action: POST
          data:
          - type: zero
            rate: 0
    `;

    const ADD_CHANGE_SET_2 = `
      - operation: ADD_CHANGE_SET
        description: 2021 VAT Rates
        effective: 2021-04-05T00:00:00.000Z
        frames:
        - entity: VAT Rate
          version: 1
          action: POST
          data:
          - type: standard
            rate: 0.125
        - entity: VAT Rate
          version: 1
          action: POST
          data:
          - type: reduced
            rate: 0.07
    `;

    const ADD_CHANGE_SET_3 = `
      - operation: ADD_CHANGE_SET
        description: 2022 VAT Rates
        effective: 2022-04-05T00:00:00.000Z
        frames:
        - entity: VAT Rate
          version: 1
          action: POST
          data:
          - type: standard
            rate: 0.15
        - entity: VAT Rate
          version: 1
          action: POST
          data:
          - type: reduced
            rate: 0.10
    `;
    const ALL_YAML = [
      ADD_ENTITY,
      ADD_PROJECTION,
      ADD_CHANGE_SET_1,
      ADD_CHANGE_SET_2,
      ADD_CHANGE_SET_3,
    ].join('\n');

    it('should aggregate data frames up to the specified change set', async (t) => {
      await applyYaml(t.name, ALL_YAML);

      const projection = await filby.getProjection('VAT Rates', 1);
      const changeLog = await filby.getChangeLog(projection);

      await filby.withTransaction(async (tx) => {
        const { rows: aggregate1 } = await tx.query('SELECT * FROM get_vat_rate_v1_aggregate($1) ORDER BY rate DESC', [changeLog[0].id]);
        eq(aggregate1.length, 3);
        deq(aggregate1[0], { type: 'standard', rate: 0.10 });
        deq(aggregate1[1], { type: 'reduced', rate: 0.05 });
        deq(aggregate1[2], { type: 'zero', rate: 0 });

        const { rows: aggregate3 } = await tx.query('SELECT * FROM get_vat_rate_v1_aggregate($1) ORDER BY rate DESC NULLS LAST', [changeLog[2].id]);
        eq(aggregate3.length, 3);
        deq(aggregate3[0], { type: 'standard', rate: 0.15 });
        deq(aggregate3[1], { type: 'reduced', rate: 0.10 });
        deq(aggregate1[2], { type: 'zero', rate: 0 });
      });
    });

    it('should exclude aggregates where the most recent frame was a delete', async (t) => {
      await applyYaml(
        t.name,
        transform(ALL_YAML).set('4.frames.1.action', 'DELETE'),
      );

      const projection = await filby.getProjection('VAT Rates', 1);
      const changeLog = await filby.getChangeLog(projection);

      await filby.withTransaction(async (tx) => {
        const { rows: aggregate1 } = await tx.query('SELECT * FROM get_vat_rate_v1_aggregate($1) ORDER BY rate DESC', [changeLog[0].id]);
        eq(aggregate1.length, 3);
        deq(aggregate1[0], { type: 'standard', rate: 0.10 });
        deq(aggregate1[1], { type: 'reduced', rate: 0.05 });
        deq(aggregate1[2], { type: 'zero', rate: 0 });

        const { rows: aggregate3 } = await tx.query('SELECT * FROM get_vat_rate_v1_aggregate($1) ORDER BY rate DESC NULLS LAST', [changeLog[2].id]);
        eq(aggregate3.length, 2);
        deq(aggregate3[0], { type: 'standard', rate: 0.15 });
        deq(aggregate3[1], { type: 'zero', rate: 0 });
      });
    });

    it('should load data frames from csv files', async (t) => {

      const transforms = [
        (yaml) => transform(yaml).set('2.frames.0.source', './test/dsl/datafiles/vat-rate-v1-2020.csv'),
        (yaml) => transform(yaml).del('2.frames.0.action'),
        (yaml) => transform(yaml).del('2.frames.0.data'),
        (yaml) => transform(yaml).del('2.frames.1'),
        (yaml) => transform(yaml).del('2.frames.1'),
        (yaml) => transform(yaml).set('3.frames.0.source', './test/dsl/datafiles/vat-rate-v1-2021.csv'),
        (yaml) => transform(yaml).del('3.frames.0.action'),
        (yaml) => transform(yaml).del('3.frames.0.data'),
        (yaml) => transform(yaml).del('3.frames.1'),
        (yaml) => transform(yaml).set('4.frames.0.source', './test/dsl/datafiles/vat-rate-v1-2022.csv'),
        (yaml) => transform(yaml).del('4.frames.0.action'),
        (yaml) => transform(yaml).del('4.frames.0.data'),
        (yaml) => transform(yaml).del('4.frames.1'),
      ];

      const yaml = transforms.reduce((document, tx) => {
        return tx(document);
      }, ALL_YAML);

      await applyYaml(t.name, yaml);

      const projection = await filby.getProjection('VAT Rates', 1);
      const changeLog = await filby.getChangeLog(projection);

      await filby.withTransaction(async (tx) => {
        const { rows: aggregate1 } = await tx.query('SELECT * FROM get_vat_rate_v1_aggregate($1) ORDER BY rate DESC', [changeLog[0].id]);
        eq(aggregate1.length, 3);
        deq(aggregate1[0], { type: 'standard', rate: 0.10 });
        deq(aggregate1[1], { type: 'reduced', rate: 0.05 });
        deq(aggregate1[2], { type: 'zero', rate: 0 });

        const { rows: aggregate3 } = await tx.query('SELECT * FROM get_vat_rate_v1_aggregate($1) ORDER BY rate DESC NULLS LAST', [changeLog[2].id]);
        eq(aggregate3.length, 2);
        deq(aggregate3[0], { type: 'standard', rate: 0.15 });
        deq(aggregate3[1], { type: 'zero', rate: 0 });
      });
    });

    it('should report bad csv files', async (t) => {

      const transforms = [
        (yaml) => transform(yaml).set('2.frames.0.source', './test/dsl/datafiles/bad.csv'),
        (yaml) => transform(yaml).del('2.frames.0.action'),
        (yaml) => transform(yaml).del('2.frames.0.data'),
        (yaml) => transform(yaml).del('2.frames.1'),
        (yaml) => transform(yaml).del('2.frames.1'),
        (yaml) => transform(yaml).del('3'),
        (yaml) => transform(yaml).del('4'),
      ];

      const yaml = transforms.reduce((document, tx) => {
        return tx(document);
      }, ALL_YAML);

      await rejects(() => applyYaml(t.name, yaml), (err) => {
        eq(err.message, 'Error parsing ./test/dsl/datafiles/bad.csv:3 - Too few fields: expected 3 fields but parsed 2');
        return true;
      });
    });

    it('should make aggregates available from the API', async (t) => {
      await applyYaml(
        t.name,
        transform(ALL_YAML).set('4.frames.1.action', 'DELETE'),
      );

      const projection = await filby.getProjection('VAT Rates', 1);
      const changeLog = await filby.getChangeLog(projection);

      const aggregate1 = await filby.getAggregates(changeLog[0].id, 'VAT Rate', 1);
      eq(aggregate1.length, 3);
      deq(aggregate1[0], { type: 'reduced', rate: 0.05 });
      deq(aggregate1[1], { type: 'standard', rate: 0.10 });
      deq(aggregate1[2], { type: 'zero', rate: 0 });

      const aggregate3 = await filby.getAggregates(changeLog[2].id, 'VAT Rate', 1);
      eq(aggregate3.length, 2);
      deq(aggregate3[0], { type: 'standard', rate: 0.15 });
      deq(aggregate3[1], { type: 'zero', rate: 0 });
    });

    it('should report aggregates that dont exist', async () => {
      await rejects(filby.getAggregates(99, 'VAT Rate', 2), (err) => {
        eq(err.message, "Function 'get_vat_rate_v2_aggregate' does not exist");
        return true;
      });

      await rejects(filby.getAggregates(99, 'Dummy', 1), (err) => {
        eq(err.message, "Function 'get_dummy_v1_aggregate' does not exist");
        return true;
      });
    });

    it('should report sql injection attempts', async () => {
      await rejects(filby.getAggregates(99, 'VAT Rate;DROP DATABASE fby_test;', 2), (err) => {
        eq(err.message, "Function 'get_vat_rate;drop_database_fby_test;_v2_aggregate' does not exist");
        return true;
      });
    });
  });

  describe('Migrations', () => {
    it('supports YAML', async (t) => {
      await applyYaml(t.name, `
        - operation: ADD_ENTITY
          name: VAT Rate
          version: 1
          fields:
          - name: type
            type: TEXT
          - name: rate
            type: NUMERIC
          identified_by:
          - type
        `);

      const { rows: entities } = await filby.withTransaction((tx) => tx.query('SELECT name, version FROM fby_entity'));

      eq(entities.length, 1);
      deq(entities[0], { name: 'VAT Rate', version: 1 });
    });

    it('support JSON', async (t) => {
      await applyJson(t.name, `
          [
            {
              "operation": "ADD_ENTITY",
              "name": "VAT Rate",
              "version": 1,
              "fields": [
                {
                  "name": "type",
                  "type": "TEXT"
                },
                {
                  "name": "rate",
                  "type": "NUMERIC"
                }
              ],
              "identified_by": [
                "type"
              ]
            }
          ]`);

      const { rows: entities } = await filby.withTransaction((tx) => tx.query('SELECT name, version FROM fby_entity'));

      eq(entities.length, 1);
      deq(entities[0], { name: 'VAT Rate', version: 1 });
    });

    it('supports SQL', async (t) => {
      await applySql(t.name, `
        INSERT INTO fby_entity(id, name, version) VALUES
          (1, 'VAT Rate', 1);
        `);

      const { rows: entities } = await filby.withTransaction((tx) => tx.query('SELECT name, version FROM fby_entity'));

      eq(entities.length, 1);
      deq(entities[0], { name: 'VAT Rate', version: 1 });
    });

    it('should report unsupported file types', async (t) => {
      await rejects(() => apply(t.name, 'UNSUPPORTED', 'yml'), (err) => {
        eq(err.message, 'Unsupported file type: 001.should-report-unsupported-file-types.yml');
        return true;
      });
    });
  });

  async function applyYaml(name, script) {
    return apply(name, script, 'yaml');
  }

  async function applyJson(name, script) {
    return apply(name, script, 'json');
  }

  async function applySql(name, script) {
    return apply(name, script, 'sql');
  }

  async function apply(name, script, extension) {
    fs.writeFileSync(path.join(__dirname, 'dsl', `001.${name.replace(/ /g, '-')}.${extension}`).toLowerCase(), script, { encoding: 'utf-8' });
    return filby.init();
  }

  function deleteMigrations() {
    fs.readdirSync(path.join(__dirname, 'dsl'))
      .filter((file) => ['.yaml', '.json', '.sql', '.yml'].includes(path.extname(file)))
      .map((file) => path.join(__dirname, 'dsl', file))
      .forEach((file) => fs.unlinkSync(file));
  }
});

function transform(source) {
  const json = YAML.parse(source);
  return Object.keys(op).reduce((api, key) => ({
    ...api,
    [key]: (...args) => {
      const output = YAML.stringify(op[key](json, ...args));
      return output;
    },
  }), {});
}
