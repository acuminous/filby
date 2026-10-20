const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const { ok, strictEqual: eq, deepEqual: deq, rejects, doesNotThrow } = require('node:assert');
const { describe, it, before, beforeEach, after } = require('node:test');
const YAML = require('yaml');
const op = require('object-path-immutable');
const { PostgresError: { INVALID_NAME, SYNTAX_ERROR, CHECK_VIOLATION, NOT_NULL_VIOLATION, FOREIGN_KEY_VIOLATION, INVALID_TEXT_REPRESENTATION, INVALID_DATETIME_FORMAT, UNSAFE_NEW_ENUM_VALUE_USAGE } } = require('pg-error-enum');

const TestFilby = require('./TestFilby');
const { table } = require('../lib/helpers');
const validateMigration = require('../lib/validate-migration');
const driver = require('../lib/marv-filby-driver');

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
    await tx.query('DROP TABLE IF EXISTS vat_rate_v2');
    await tx.query('DROP FUNCTION IF EXISTS get_vat_rate_v2_aggregate');
    await tx.query('DROP TABLE IF EXISTS cgt_rate_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_cgt_rate_v1_aggregate');
    await tx.query('DROP TYPE IF EXISTS vat_tax_rate');
    await tx.query('DROP TYPE IF EXISTS cgt_tax_rate');
    await tx.query('DROP TYPE IF EXISTS season_type');
    await tx.query('DROP SCHEMA IF EXISTS other CASCADE');
    await tx.query('DROP TYPE IF EXISTS pwned');
    await tx.query('DROP TYPE IF EXISTS "pwned_as_enum_();_raise_exception_$💀$you_have_been_pwned!$💀$;_create_type_vat_tax_rate"');
    await tx.query('DROP TABLE IF EXISTS "pwned\',_1);raise_exception_$💀$you_have_been_pwned!$💀$;_v1"');
    await tx.query('DROP FUNCTION IF EXISTS "get_pwned\',_1);raise_exception_$💀$you_have_been_pwned!$💀$;_v1_aggregate"');
  },
};

const ADD_ENUM = loadYaml('ADD_ENUM');
const ALTER_ENUM = loadYaml('ALTER_ENUM');
const DROP_ENUM = loadYaml('DROP_ENUM');
const ADD_ENTITY = loadYaml('ADD_ENTITY');
const DROP_ENTITY = loadYaml('DROP_ENTITY');
const ADD_PROJECTION = loadYaml('ADD_PROJECTION');
const ADD_ROOT_PROJECTION = loadYaml('ADD_ROOT_PROJECTION');
const ADD_PARK_ENTITIES = loadYaml('ADD_PARK_ENTITIES');
const ADD_NESTED_PROJECTION = loadYaml('ADD_NESTED_PROJECTION');
const ADD_PARK_CHANGE_SET = loadYaml('ADD_PARK_CHANGE_SET');
const ADD_SEASON_CHANGE_SET = loadYaml('ADD_SEASON_CHANGE_SET');
const DROP_PROJECTION = loadYaml('DROP_PROJECTION');
const ADD_CHANGE_SET_1 = loadYaml('ADD_CHANGE_SET_1');
const ADD_HOOK_ADD_PROJECTION = loadYaml('ADD_HOOK_ADD_PROJECTION');
const ADD_HOOK_DROP_PROJECTION = loadYaml('ADD_HOOK_DROP_PROJECTION');
const ADD_HOOK_CHANGE_SET_PROJECTION = loadYaml('ADD_HOOK_CHANGE_SET_PROJECTION');
const ADD_HOOK_CHANGE_SET_GENERAL = loadYaml('ADD_HOOK_CHANGE_SET_GENERAL');
const DROP_HOOK_ADD_CHANGE_SET_PROJECTION = loadYaml('DROP_HOOK_ADD_CHANGE_SET_PROJECTION');
const DROP_HOOK_ADD_CHANGE_SET_GENERAL = loadYaml('DROP_HOOK_ADD_CHANGE_SET_GENERAL');

describe('DSL', () => {

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

  describe('General Validation', () => {
    it('should report unknown terms', async (t) => {
      await rejects(filby.applyYaml(t.name, '- operation: WOMBAT'), (err) => {
        eq(err.message, "001.should-report-unknown-terms.yaml: /0/operation must be equal to one of the allowed values 'ADD_ENUM', 'ADD_ENTITY', 'ADD_PROJECTION', 'ADD_HOOK', 'ADD_CHANGE_SET', 'ALTER_ENUM', 'DROP_ENUM', 'DROP_ENTITY', 'DROP_PROJECTION' or 'DROP_HOOK'");
        return true;
      });
    });

    it('should report invalid operation type', async (t) => {
      await rejects(filby.applyYaml(t.name, '- operation: 1'), (err) => {
        eq(err.message, "001.should-report-invalid-operation-type.yaml: /0/operation must be of type 'string'");
        return true;
      });
    });
  });

  describe('Add Enum', () => {

    it('should add enum', async (t) => {
      await filby.applyYaml(t.name, ADD_ENUM);

      const { rows: labels } = await filby.withTransaction((tx) => tx.query("SELECT enumlabel AS label FROM pg_enum WHERE enumtypid = 'vat_tax_rate'::regtype"));
      eq(labels.length, 3);
      deq(labels[0], { label: 'standard' });
      deq(labels[1], { label: 'reduced' });
      deq(labels[2], { label: 'zero' });
    });

    it('should record enum values', async (t) => {
      await filby.applyYaml(t.name, ADD_ENUM);

      const { rows: values } = await filby.withTransaction((tx) => tx.query('SELECT name, position, value FROM fby_enum ORDER BY position'));
      deq(values, [
        { name: 'vat_tax_rate', position: 1, value: 'standard' },
        { name: 'vat_tax_rate', position: 2, value: 'reduced' },
        { name: 'vat_tax_rate', position: 3, value: 'zero' },
      ]);
    });

    it('should reject duplicate enum', async (t) => {
      await filby.applyYaml(t.name, ADD_ENUM);
      await rejects(() => filby.applyYaml(t.name, ADD_ENUM), (err) => {
        eq(err.message, "Enum 'vat_tax_rate' already exists");
        return true;
      });
    });

    it('should require a name', async (t) => {
      await rejects(() => filby.applyYaml(
        t.name,
        transform(ADD_ENUM).del('0.name'),
      ), (err) => {
        eq(err.message, "001.should-require-a-name.yaml: /0 must have required property 'name'");
        return true;
      });
    });

    it('should require name to be a string', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENUM).set('0.name', 1)), (err) => {
        eq(err.message, "001.should-require-name-to-be-a-string.yaml: /0/name must be of type 'string'");
        return true;
      });
    });

    it('should escape name', async (t) => {
      await filby.applyYaml(t.name, transform(ADD_ENUM).set('0.name', 'pwned AS ENUM (); RAISE EXCEPTION $💀$You have been pwned!$💀$; CREATE TYPE vat_tax_rate'));
      const { rows: labels } = await filby.withTransaction((tx) => tx.query("SELECT * FROM pg_type WHERE typname LIKE 'pwned%' AND typtype = 'e'"));
      eq(labels.length, 1);
    });

    it('should require at least one value', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENUM).del('0.values')), (err) => {
        eq(err.message, "001.should-require-at-least-one-value.yaml: /0 must have required property 'values'");
        return true;
      });

      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENUM).set('0.values', 1)), (err) => {
        eq(err.message, "001.should-require-at-least-one-value.yaml: /0/values must be of type 'array'");
        return true;
      });

      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENUM).set('0.values', [])), (err) => {
        eq(err.message, '001.should-require-at-least-one-value.yaml: /0/values must NOT have fewer than 1 items');
        return true;
      });
    });

    it('should require values to be strings', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENUM).set('0.values.0', 1)), (err) => {
        eq(err.message, "001.should-require-values-to-be-strings.yaml: /0/values/0 must be of type 'string'");
        return true;
      });
    });

    it('should escape values', async (t) => {
      await rejects(filby.applyYaml(t.name, transform(ADD_ENUM).set('0.values.0', "pwned'); RAISE EXCEPTION $💀$You have been pwned!$💀$; CREATE TYPE pwned AS ENUM ('standard")), (err) => {
        eq(err.code, INVALID_NAME);
        return true;
      });
    });

    it('should allow a description', async (t) => {
      await filby.applyYaml(t.name, transform(ADD_ENUM).merge('0.description', 'wombat'));
    });

    it('should require description to be a string', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENUM).merge('0.description', 1)), (err) => {
        eq(err.message, "001.should-require-description-to-be-a-string.yaml: /0/description must be of type 'string'");
        return true;
      });
    });

    it('should forbid additional properties', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENUM).merge('0', { wombat: 1 })), (err) => {
        eq(err.message, "001.should-forbid-additional-properties.yaml: /0 must NOT have additional property 'wombat'");
        return true;
      });
    });
  });

  describe('Alter Enum', () => {

    const ADD_ENUM_ENTITY = `
- operation: ADD_ENTITY
  name: VAT Rate
  version: 1
  fields:
    - name: type
      type: vat_tax_rate
    - name: rate
      type: NUMERIC
  identified_by:
    - type
`;

    const ADD_EXEMPT_RATE = `
- operation: ADD_CHANGE_SET
  description: Exempt VAT Rate
  effective: 2020-04-05T00:00:00.000Z
  frames:
    - entity: VAT Rate
      version: 1
      action: SET
      data:
        - type: exempt
          rate: 0
`;

    it('should add values after the existing ones', async (t) => {
      await filby.applyYaml(t.name, ADD_ENUM, ALTER_ENUM);

      const { rows: labels } = await filby.withTransaction((tx) => tx.query("SELECT enumlabel AS label FROM pg_enum WHERE enumtypid = 'vat_tax_rate'::regtype ORDER BY enumsortorder"));
      deq(labels, [
        { label: 'standard' },
        { label: 'reduced' },
        { label: 'zero' },
        { label: 'exempt' },
        { label: 'outside_scope' },
      ]);
    });

    it('should record added values', async (t) => {
      await filby.applyYaml(t.name, ADD_ENUM, ALTER_ENUM);

      const { rows: values } = await filby.withTransaction((tx) => tx.query('SELECT name, position, value FROM fby_enum ORDER BY position'));
      deq(values, [
        { name: 'vat_tax_rate', position: 1, value: 'standard' },
        { name: 'vat_tax_rate', position: 2, value: 'reduced' },
        { name: 'vat_tax_rate', position: 3, value: 'zero' },
        { name: 'vat_tax_rate', position: 4, value: 'exempt' },
        { name: 'vat_tax_rate', position: 5, value: 'outside_scope' },
      ]);
    });

    it('should look the enum up by its canonical name', async (t) => {
      const ADD_SEASON_TYPE = `
- operation: ADD_ENUM
  name: Season Type
  values:
    - Owners
    - Guests
`;

      const ALTER_SEASON_TYPE = `
- operation: ALTER_ENUM
  name: Season Type
  add:
    - Staff
`;

      await filby.applyYaml(t.name, ADD_SEASON_TYPE, ALTER_SEASON_TYPE);

      const { rows: labels } = await filby.withTransaction((tx) => tx.query("SELECT enumlabel AS label FROM pg_enum WHERE enumtypid = 'season_type'::regtype ORDER BY enumsortorder"));
      deq(labels, [
        { label: 'Owners' },
        { label: 'Guests' },
        { label: 'Staff' },
      ]);

      const { rows: values } = await filby.withTransaction((tx) => tx.query('SELECT name, position, value FROM fby_enum ORDER BY position'));
      deq(values, [
        { name: 'season_type', position: 1, value: 'Owners' },
        { name: 'season_type', position: 2, value: 'Guests' },
        { name: 'season_type', position: 3, value: 'Staff' },
      ]);
    });

    it('should allow a change set in a later file to use an added value', async (t) => {
      await filby.applyYaml(t.name, ADD_ENUM, ADD_ENUM_ENTITY, ALTER_ENUM);
      await applyLaterYaml(t.name, ADD_EXEMPT_RATE);

      const { rows } = await filby.withTransaction((tx) => tx.query('SELECT type FROM vat_rate_v1'));
      deq(rows, [{ type: 'exempt' }]);
    });

    it('should reject a change set in the same file that uses an added value', async (t) => {
      await filby.applyYaml(t.name, ADD_ENUM, ADD_ENUM_ENTITY);
      await rejects(() => applyLaterYaml(t.name, ALTER_ENUM, ADD_EXEMPT_RATE), (err) => {
        eq(err.code, UNSAFE_NEW_ENUM_VALUE_USAGE);
        eq(err.message, '002.should-reject-a-change-set-in-the-same-file-that-uses-an-added-value.yaml: /1/frames/0/data/0 - unsafe use of new value "exempt" of enum type vat_tax_rate');
        return true;
      });
    });

    it('should reject existing values', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENUM, transform(ALTER_ENUM).set('0.add', ['exempt', 'standard'])), (err) => {
        eq(err.message, "Enum 'vat_tax_rate' already has value 'standard'");
        return true;
      });
    });

    it('should reject duplicate values', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENUM, transform(ALTER_ENUM).set('0.add', ['exempt', 'exempt'])), (err) => {
        eq(err.message, "Enum 'vat_tax_rate' already has value 'exempt'");
        return true;
      });
    });

    it('should report missing enums', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ALTER_ENUM), (err) => {
        eq(err.message, "Enum 'vat_tax_rate' does not exist");
        return true;
      });
    });

    it('should require a name', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ALTER_ENUM).del('0.name')), (err) => {
        eq(err.message, "001.should-require-a-name.yaml: /0 must have required property 'name'");
        return true;
      });
    });

    it('should require name to be a string', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ALTER_ENUM).set('0.name', 1)), (err) => {
        eq(err.message, "001.should-require-name-to-be-a-string.yaml: /0/name must be of type 'string'");
        return true;
      });
    });

    it('should escape name', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENUM, transform(ALTER_ENUM).set('0.name', 'vat_tax_rate; RAISE EXCEPTION $💀$You have been pwned!$💀$;')), (err) => {
        eq(err.message, "Enum 'vat_tax_rate; RAISE EXCEPTION $💀$You have been pwned!$💀$;' does not exist");
        return true;
      });
    });

    it('should require at least one value', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ALTER_ENUM).del('0.add')), (err) => {
        eq(err.message, "001.should-require-at-least-one-value.yaml: /0 must have required property 'add'");
        return true;
      });

      await rejects(() => filby.applyYaml(t.name, transform(ALTER_ENUM).set('0.add', 1)), (err) => {
        eq(err.message, "001.should-require-at-least-one-value.yaml: /0/add must be of type 'array'");
        return true;
      });

      await rejects(() => filby.applyYaml(t.name, transform(ALTER_ENUM).set('0.add', [])), (err) => {
        eq(err.message, '001.should-require-at-least-one-value.yaml: /0/add must NOT have fewer than 1 items');
        return true;
      });
    });

    it('should require values to be strings', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ALTER_ENUM).set('0.add.0', 1)), (err) => {
        eq(err.message, "001.should-require-values-to-be-strings.yaml: /0/add/0 must be of type 'string'");
        return true;
      });
    });

    it('should escape values', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENUM, transform(ALTER_ENUM).set('0.add.0', "pwned'); RAISE EXCEPTION $💀$You have been pwned!$💀$; CREATE TYPE pwned AS ENUM ('standard")), (err) => {
        eq(err.code, INVALID_NAME);
        return true;
      });
    });

    it('should allow a description', async (t) => {
      await filby.applyYaml(t.name, ADD_ENUM, transform(ALTER_ENUM).merge('0.description', 'wombat'));
    });

    it('should require description to be a string', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ALTER_ENUM).merge('0.description', 1)), (err) => {
        eq(err.message, "001.should-require-description-to-be-a-string.yaml: /0/description must be of type 'string'");
        return true;
      });
    });

    it('should forbid additional properties', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ALTER_ENUM).merge('0', { wombat: 1 })), (err) => {
        eq(err.message, "001.should-forbid-additional-properties.yaml: /0 must NOT have additional property 'wombat'");
        return true;
      });
    });

    async function applyLaterYaml(name, ...script) {
      const slug = name.replace(/ /g, '-').toLowerCase();
      await fs.promises.unlink(path.join(__dirname, 'migrations', `001.${slug}.yaml`));
      await fs.promises.writeFile(path.join(__dirname, 'migrations', `002.${slug}.yaml`), script.join('\n'), { encoding: 'utf-8' });
      return filby.init();
    }
  });

  describe('Drop Enum', () => {

    it('should drop enum', async (t) => {
      await filby.applyYaml(t.name, ADD_ENUM, DROP_ENUM);

      const { rows: enums } = await filby.withTransaction((tx) => tx.query("SELECT * FROM pg_type WHERE typname LIKE '%_tax_rate' AND typtype = 'e'"));
      eq(enums.length, 0);
    });

    it('should remove recorded enum values', async (t) => {
      await filby.applyYaml(t.name, ADD_ENUM, DROP_ENUM);

      const { rows: values } = await filby.withTransaction((tx) => tx.query('SELECT * FROM fby_enum'));
      eq(values.length, 0);
    });

    it('should ignore other enums', async (t) => {
      const ADD_ANOTHER_ENUM = `
- operation: ADD_ENUM
  name: 'cgt_tax_rate'
  values:
  - residential_property
  - commercial_property
`;

      await filby.applyYaml(t.name, ADD_ENUM, ADD_ANOTHER_ENUM, DROP_ENUM);

      const { rows: enums } = await filby.withTransaction((tx) => tx.query("SELECT * FROM pg_type WHERE typname LIKE '%_tax_rate' AND typtype = 'e'"));
      eq(enums.length, 1);
    });

    it('should look the enum up by its canonical name', async (t) => {
      const ADD_SEASON_TYPE = `
- operation: ADD_ENUM
  name: Season Type
  values:
    - Owners
    - Guests
`;

      const DROP_SEASON_TYPE = `
- operation: DROP_ENUM
  name: Season Type
`;

      await filby.applyYaml(t.name, ADD_SEASON_TYPE, DROP_SEASON_TYPE);

      const { rows: enums } = await filby.withTransaction((tx) => tx.query("SELECT * FROM pg_type WHERE typname = 'season_type' AND typtype = 'e'"));
      eq(enums.length, 0);

      const { rows: values } = await filby.withTransaction((tx) => tx.query("SELECT * FROM fby_enum WHERE name = 'season_type'"));
      eq(values.length, 0);
    });

    it('should require a name', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(DROP_ENUM).del('0.name')), (err) => {
        eq(err.message, "001.should-require-a-name.yaml: /0 must have required property 'name'");
        return true;
      });
    });

    it('should require name to be a string', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(DROP_ENUM).set('0.name', 1)), (err) => {
        eq(err.message, "001.should-require-name-to-be-a-string.yaml: /0/name must be of type 'string'");
        return true;
      });
    });

    it('should escape name', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENUM, transform(DROP_ENUM).set('0.name', 'vat_tax_rate; RAISE EXCEPTION $💀$You have been pwned!$💀$;')), (err) => {
        eq(err.message, "Enum 'vat_tax_rate; RAISE EXCEPTION $💀$You have been pwned!$💀$;' does not exist");
        return true;
      });
    });

    it('should allow a description', async (t) => {
      await filby.applyYaml(t.name, ADD_ENUM, transform(DROP_ENUM).merge('0.description', 'wombat'));
    });

    it('should require description to be a string', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(DROP_ENUM).merge('0.description', 1)), (err) => {
        eq(err.message, "001.should-require-description-to-be-a-string.yaml: /0/description must be of type 'string'");
        return true;
      });
    });

    it('should forbid additional properties', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(DROP_ENUM).merge('0', { wombat: 1 })), (err) => {
        eq(err.message, "001.should-forbid-additional-properties.yaml: /0 must NOT have additional property 'wombat'");
        return true;
      });
    });

    it('should report missing enums', async (t) => {
      await rejects(() => filby.applyYaml(t.name, DROP_ENUM), (err) => {
        eq(err.message, "Enum 'vat_tax_rate' does not exist");
        return true;
      });
    });
  });

  describe('Add Entity', () => {

    it('should add entity', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY);

      const { rows: entities } = await filby.withTransaction((tx) => tx.query('SELECT name, version FROM fby_entity'));
      eq(entities.length, 1);
      deq(entities[0], { name: 'VAT Rate', version: 1 });
    });

    it('should record entity fields', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY);

      deq(await getEntityFields(), [
        { position: 1, name: 'type', type: 'TEXT', identity: true },
        { position: 2, name: 'rate', type: 'NUMERIC', identity: false },
      ]);
    });

    it('should record canonical field names', async (t) => {
      await filby.applyYaml(t.name, transform(transform(ADD_ENTITY).set('0.fields.0.name', 'Tax Type')).set('0.identified_by.0', 'Tax Type'));

      const [field] = await getEntityFields();
      eq(field.name, 'tax_type');
    });

    it('should record entity checks', async (t) => {
      await filby.applyYaml(t.name, transform(ADD_ENTITY).merge('0.checks', { min_rate: '(rate >= 0)', max_rate: '(rate <= 1)' }));

      const { rows: checks } = await filby.withTransaction((tx) => tx.query('SELECT name, expression FROM fby_entity_check ORDER BY name'));
      deq(checks, [
        { name: 'max_rate', expression: '(rate <= 1)' },
        { name: 'min_rate', expression: '(rate >= 0)' },
      ]);
    });

    it('should constrain entity tables to one frame per key per change set', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY);

      const { rows: constraints } = await filby.withTransaction((tx) => tx.query(`
        SELECT c.contype AS type, array_agg(a.attname::TEXT ORDER BY k.ordinality) AS columns, c.confdeltype AS on_delete
        FROM pg_constraint c
        CROSS JOIN unnest(c.conkey) WITH ORDINALITY k (attnum, ordinality)
        INNER JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
        WHERE c.conrelid = 'vat_rate_v1'::regclass
          AND c.contype IN ('u', 'f')
        GROUP BY c.oid, c.contype, c.confdeltype
        ORDER BY c.contype`));
      deq(constraints, [
        { type: 'f', columns: ['fby_frame_id', 'fby_change_set_id'], on_delete: 'c' },
        { type: 'u', columns: ['fby_change_set_id', 'type'], on_delete: ' ' },
      ]);
    });

    it('should reject duplicate entity', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY);
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY), (err) => {
        eq(err.message, "Entity 'VAT Rate v1' already exists");
        return true;
      });
    });

    it('should require a name', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).del('0.name')), (err) => {
        eq(err.message, "001.should-require-a-name.yaml: /0 must have required property 'name'");
        return true;
      });
    });

    it('should require name to be a string', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.name', 1)), (err) => {
        eq(err.message, "001.should-require-name-to-be-a-string.yaml: /0/name must be of type 'string'");
        return true;
      });
    });

    it('should escape name', async (t) => {
      await filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.name', "pwned', 1);RAISE EXCEPTION $💀$You have been pwned!$💀$;"));
      const { rows: entities } = await filby.withTransaction((tx) => tx.query('SELECT name, version FROM fby_entity'));
      eq(entities.length, 1);
      deq(entities[0], { name: "pwned', 1);RAISE EXCEPTION $💀$You have been pwned!$💀$;", version: 1 });
    });

    it('should default version to 1', async (t) => {
      await filby.applyYaml(t.name, transform(ADD_ENTITY).del('0.version'), ADD_CHANGE_SET_1);

      const { rows: entities } = await filby.withTransaction((tx) => tx.query('SELECT name, version FROM fby_entity'));
      deq(entities, [{ name: 'VAT Rate', version: 1 }]);
      eq((await getDataFrames('2020 VAT Rates')).length, 3);
    });

    it('should require version to be an integer', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.version', 1.1)), (err) => {
        eq(err.message, "001.should-require-version-to-be-an-integer.yaml: /0/version must be of type 'integer'");
        return true;
      });
    });

    it('should accept fields as a map', async (t) => {
      await filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.fields', { type: 'TEXT', rate: 'NUMERIC' }), ADD_CHANGE_SET_1);

      deq(await getEntityFields(), [
        { position: 1, name: 'type', type: 'TEXT', identity: true },
        { position: 2, name: 'rate', type: 'NUMERIC', identity: false },
      ]);
      eq((await getDataFrames('2020 VAT Rates')).length, 3);
    });

    it('should accept the long field form', async (t) => {
      await filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.fields', { type: { type: 'TEXT' }, rate: { type: 'NUMERIC', nullable: false } }), ADD_CHANGE_SET_1);

      deq(await getEntityFields(), [
        { position: 1, name: 'type', type: 'TEXT', identity: true },
        { position: 2, name: 'rate', type: 'NUMERIC', identity: false },
      ]);
      eq((await getDataFrames('2020 VAT Rates')).length, 3);
    });

    it('should record nullable fields', async (t) => {
      await filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.fields', { type: 'TEXT', rate: { type: 'NUMERIC', nullable: false }, notes: { type: 'TEXT', nullable: true }, source: 'TEXT' }));

      deq(await getEntityNullability(), [
        { name: 'type', nullable: false },
        { name: 'rate', nullable: false },
        { name: 'notes', nullable: true },
        { name: 'source', nullable: true },
      ]);
    });

    it('should record nullable fields in the list form', async (t) => {
      await filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.fields.1.nullable', false));

      deq(await getEntityNullability(), [
        { name: 'type', nullable: false },
        { name: 'rate', nullable: false },
      ]);
    });

    it('should require at least one field in the map form', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.fields', {})), (err) => {
        eq(err.message, '001.should-require-at-least-one-field-in-the-map-form.yaml: /0/fields must NOT have fewer than 1 properties');
        return true;
      });
    });

    it('should require map form fields to be a type or a definition', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.fields', { type: 1 })), (err) => {
        eq(err.message, "001.should-require-map-form-fields-to-be-a-type-or-a-definition.yaml: /0/fields/type must be of type 'string' or 'object'");
        return true;
      });
    });

    it('should require long form fields to have a type', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.fields', { type: { nullable: false } })), (err) => {
        eq(err.message, "001.should-require-long-form-fields-to-have-a-type.yaml: /0/fields/type must have required property 'type'");
        return true;
      });
    });

    it('should require nullable to be a boolean', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.fields', { type: { type: 'TEXT', nullable: 'wombat' } })), (err) => {
        eq(err.message, "001.should-require-nullable-to-be-a-boolean.yaml: /0/fields/type/nullable must be of type 'boolean'");
        return true;
      });

      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.fields.0.nullable', 'wombat')), (err) => {
        eq(err.message, "001.should-require-nullable-to-be-a-boolean.yaml: /0/fields/0/nullable must be of type 'boolean'");
        return true;
      });
    });

    it('should forbid additional properties in long form fields', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.fields', { type: { type: 'TEXT', wombat: 1 } })), (err) => {
        eq(err.message, "001.should-forbid-additional-properties-in-long-form-fields.yaml: /0/fields/type must NOT have additional property 'wombat'");
        return true;
      });
    });

    it('should accept key as an equivalent of identified_by', async (t) => {
      await filby.applyYaml(t.name, transform(transform(ADD_ENTITY).del('0.identified_by')).set('0.key', ['type']), ADD_CHANGE_SET_1);

      deq(await getEntityFields(), [
        { position: 1, name: 'type', type: 'TEXT', identity: true },
        { position: 2, name: 'rate', type: 'NUMERIC', identity: false },
      ]);
      eq((await getDataFrames('2020 VAT Rates')).length, 3);
    });

    it('should require key columns to be entity field names', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(transform(ADD_ENTITY).del('0.identified_by')).set('0.key', ['wombat'])), (err) => {
        eq(err.message, "Identifier 'wombat' does not match one of the 'VAT Rate' entity field names");
        return true;
      });
    });

    it('should require at least one key column', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(transform(ADD_ENTITY).del('0.identified_by')).set('0.key', [])), (err) => {
        eq(err.message, '001.should-require-at-least-one-key-column.yaml: /0/key must NOT have fewer than 1 items');
        return true;
      });
    });

    it('should reject both key and identified_by', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.key', ['type'])), (err) => {
        eq(err.message, "Entity 'VAT Rate' must specify either 'key' or 'identified_by', not both");
        return true;
      });
    });

    it('should require at least one field', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).del('0.fields')), (err) => {
        eq(err.message, "001.should-require-at-least-one-field.yaml: /0 must have required property 'fields'");
        return true;
      });

      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.fields', 1)), (err) => {
        eq(err.message, "001.should-require-at-least-one-field.yaml: /0/fields must be of type 'array'");
        return true;
      });

      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.fields', [])), (err) => {
        eq(err.message, '001.should-require-at-least-one-field.yaml: /0/fields must NOT have fewer than 1 items');
        return true;
      });
    });

    it('should require fields to have a name', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).del('0.fields.0.name')), (err) => {
        eq(err.message, "001.should-require-fields-to-have-a-name.yaml: /0/fields/0 must have required property 'name'");
        return true;
      });
    });

    it('should require field name to be a string', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.fields.0.name', 1)), (err) => {
        eq(err.message, "001.should-require-field-name-to-be-a-string.yaml: /0/fields/0/name must be of type 'string'");
        return true;
      });
    });

    it('should escape field names', async (t) => {
      const injection = "pwned', 1);RAISE EXCEPTION $💀$You have been pwned!$💀$;";

      const transforms = [
        (yaml) => transform(yaml).set('0.fields.0.name', injection),
        (yaml) => transform(yaml).set('0.identified_by', [injection]),
      ];

      const yaml = transforms.reduce((document, tx) => {
        return tx(document);
      }, [ADD_ENTITY].join('\n'));

      await filby.applyYaml(t.name, yaml);

      const { rows: columns } = await filby.withTransaction((tx) => tx.query("SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'vat_rate_v1' ORDER BY ordinal_position"));
      eq(columns.length, 4);
      eq(columns[2].name, "pwned',_1);raise_exception_$💀$you_have_been_pwned!$💀$;");
    });

    it('should require fields to have a type', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).del('0.fields.0.type')), (err) => {
        eq(err.message, "001.should-require-fields-to-have-a-type.yaml: /0/fields/0 must have required property 'type'");
        return true;
      });
    });

    it('should require field type to be a string', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.fields.0.type', 1)), (err) => {
        eq(err.message, "001.should-require-field-type-to-be-a-string.yaml: /0/fields/0/type must be of type 'string'");
        return true;
      });
    });

    it('should reject invalid field types', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.fields.0.type', 'INVALID TYPE')), (err) => {
        eq(err.code, SYNTAX_ERROR);
        return true;
      });
    });

    it('should protect field types from sql injections', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.fields.0.type', 'TEXT);RAISE EXCEPTION $💀$You have been pwned!$💀$;')), (err) => {
        eq(err.message, "Invalid PostgreSQL TYPE 'TEXT);RAISE EXCEPTION $💀$You have been pwned!$💀$;' for field 'type' of entity 'VAT Rate v1'");
        return true;
      });

      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.fields.1.type', 'TEXT; DROP TABLE x')), (err) => {
        eq(err.message, "Invalid PostgreSQL TYPE 'TEXT; DROP TABLE x' for field 'rate' of entity 'VAT Rate v1'");
        return true;
      });

      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.fields.1.type', "TEXT'")), (err) => {
        eq(err.message, "Invalid PostgreSQL TYPE 'TEXT'' for field 'rate' of entity 'VAT Rate v1'");
        return true;
      });
    });

    it('should accept numeric field types with a precision and scale', async (t) => {
      await filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.fields.1.type', 'NUMERIC(10,2)'), setRate(12.345));

      eq(await getRate(), '12.35');
    });

    it('should accept decimal field types with a precision and scale', async (t) => {
      await filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.fields.1.type', 'DECIMAL(5,2)'), setRate(123.456));

      eq(await getRate(), '123.46');
    });

    it('should accept array field types', async (t) => {
      await filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.fields.1.type', 'TEXT[]'), setRate('{"standard","default"}'));

      deq(await getRate(), ['standard', 'default']);
    });

    it('should accept multi word field types', async (t) => {
      await filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.fields.1.type', 'TIMESTAMP WITH TIME ZONE'), setRate('2020-04-05T00:00:00.000Z'));

      eq((await getRate()).toISOString(), '2020-04-05T00:00:00.000Z');
    });

    it('should accept double precision field types', async (t) => {
      await filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.fields.1.type', 'DOUBLE PRECISION'), setRate(1.5));

      eq(await getRate(), 1.5);
    });

    it('should accept schema qualified field types', async (t) => {
      await filby.withTransaction((tx) => tx.query("CREATE SCHEMA other; CREATE TYPE other.vat_rate_band AS ENUM ('low', 'high')"));

      await filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.fields.1.type', 'other.vat_rate_band'), setRate('low'));

      eq(await getRate(), 'low');
    });

    it('should require at least one identifier column', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).del('0.identified_by')), (err) => {
        eq(err.message, "001.should-require-at-least-one-identifier-column.yaml: /0 must have required property 'identified_by'");
        return true;
      });

      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.identified_by', 1)), (err) => {
        eq(err.message, "001.should-require-at-least-one-identifier-column.yaml: /0/identified_by must be of type 'array'");
        return true;
      });

      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.identified_by', [])), (err) => {
        eq(err.message, '001.should-require-at-least-one-identifier-column.yaml: /0/identified_by must NOT have fewer than 1 items');
        return true;
      });
    });

    it('should require identifiers to be strings', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.identified_by.0', 1)), (err) => {
        eq(err.message, "001.should-require-identifiers-to-be-strings.yaml: /0/identified_by/0 must be of type 'string'");
        return true;
      });
    });

    it('should require identifiers to be entity field names', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.identified_by.0', 'wombat')), (err) => {
        eq(err.message, "Identifier 'wombat' does not match one of the 'VAT Rate' entity field names");
        return true;
      });
    });

    it('should forbid additional properties in fields', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).merge('0.fields.0', { wombat: 1 })), (err) => {
        eq(err.message, "001.should-forbid-additional-properties-in-fields.yaml: /0/fields/0 must NOT have additional property 'wombat'");
        return true;
      });
    });

    it('should allow a description', async (t) => {
      await filby.applyYaml(t.name, transform(ADD_ENTITY).merge('0.description', 'wombat'));
    });

    it('should require description to be a string', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).merge('0.description', 1)), (err) => {
        eq(err.message, "001.should-require-description-to-be-a-string.yaml: /0/description must be of type 'string'");
        return true;
      });
    });

    it('should escape description', async (t) => {
      const injection = "pwned');RAISE EXCEPTION $💀$You have been pwned!$💀$;";
      await filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.description', injection));

      const { rows: entities } = await filby.withTransaction((tx) => tx.query('SELECT description FROM fby_entity'));
      eq(entities.length, 1);
      deq(entities[0], { description: "pwned');RAISE EXCEPTION $💀$You have been pwned!$💀$;" });
    });

    it('should honour checks when enabled', async (t) => {
      await rejects(() => filby.applyYaml(
        t.name,
        transform(ADD_ENTITY).merge('0.checks', { max_rate: '(rate <= 1)' }),
        transform(ADD_CHANGE_SET_1).set('0.frames.0.data.0.rate', 1.1),
      ), (err) => {
        eq(err.code, CHECK_VIOLATION);
        return true;
      });
    });

    it('should forbid additional properties', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).merge('0', { wombat: 1 })), (err) => {
        eq(err.message, "001.should-forbid-additional-properties.yaml: /0 must NOT have additional property 'wombat'");
        return true;
      });
    });
  });

  describe('Drop Entity', () => {

    it('should drop entity', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY);

      ok(await hasTable('vat_rate_v1'));
      ok(await hasFunction('get_vat_rate_v1_aggregate'));

      await filby.applyYaml(t.name, DROP_ENTITY);

      ok(!await hasTable('vat_rate_v1'));
      ok(!await hasFunction('get_vat_rate_v1_aggregate'));
    });

    it('should remove recorded fields and checks', async (t) => {
      await filby.applyYaml(t.name, transform(ADD_ENTITY).merge('0.checks', { max_rate: '(rate <= 1)' }), DROP_ENTITY);

      const { rows: fields } = await filby.withTransaction((tx) => tx.query('SELECT * FROM fby_entity_field'));
      eq(fields.length, 0);
      const { rows: checks } = await filby.withTransaction((tx) => tx.query('SELECT * FROM fby_entity_check'));
      eq(checks.length, 0);
    });

    it('should ignore other entities', async (t) => {
      const ADD_ANOTHER_ENTITY = `
- operation: ADD_ENTITY
  name: VAT Rate
  version: 2
  fields:
  - name: type
    type: TEXT
  - name: rate
    type: DECIMAL
  identified_by:
  - type
`;
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ANOTHER_ENTITY, DROP_ENTITY);

      const { rows: entities } = await filby.withTransaction((tx) => tx.query('SELECT * FROM fby_entity'));
      eq(entities.length, 1);

      ok(await hasTable('vat_rate_v2'));
      ok(await hasFunction('get_vat_rate_v2_aggregate'));
    });

    it('should require an operation', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(DROP_ENTITY).del('0.operation')), (err) => {
        eq(err.message, "001.should-require-an-operation.yaml: /0 must have required property 'operation'");
        return true;
      });
    });

    it('should require a name', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(DROP_ENTITY).del('0.name')), (err) => {
        eq(err.message, "001.should-require-a-name.yaml: /0 must have required property 'name'");
        return true;
      });
    });

    it('should require name to be a string', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(DROP_ENTITY).set('0.name', 1)), (err) => {
        eq(err.message, "001.should-require-name-to-be-a-string.yaml: /0/name must be of type 'string'");
        return true;
      });
    });

    it('should escape name', async (t) => {
      const injection = "pwned', 1);RAISE EXCEPTION $💀$You have been pwned!$💀$;";
      const tableName = table(injection, 1);

      await filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.name', injection));
      ok(await hasTable(tableName));

      await filby.applyYaml(t.name, transform(DROP_ENTITY).set('0.name', injection));
      ok(!await hasTable(tableName));
    });

    it('should require a version', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(DROP_ENTITY).del('0.version')), (err) => {
        eq(err.message, "001.should-require-a-version.yaml: /0 must have required property 'version'");
        return true;
      });
    });

    it('should require version to be a string', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(DROP_ENTITY).set('0.version', 'wombat')), (err) => {
        eq(err.message, "001.should-require-version-to-be-a-string.yaml: /0/version must be of type 'integer'");
        return true;
      });
    });

    it('should allow a description', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(DROP_ENTITY).merge('0.description', 'wombat'));
    });

    it('should require description to be a string', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(DROP_ENTITY).merge('0.description', 1)), (err) => {
        eq(err.message, "001.should-require-description-to-be-a-string.yaml: /0/description must be of type 'string'");
        return true;
      });
    });

    it('should forbid additional properties', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(DROP_ENTITY).merge('0', { wombat: 1 })), (err) => {
        eq(err.message, "001.should-forbid-additional-properties.yaml: /0 must NOT have additional property 'wombat'");
        return true;
      });
    });

    it('should report missing entities', async (t) => {
      await rejects(() => filby.applyYaml(t.name, DROP_ENTITY), (err) => {
        eq(err.message, "Entity 'VAT Rate v1' does not exist");
        return true;
      });
    });
  });

  describe('Add Projection', () => {

    it('should add projection', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION);
      const { rows: projections } = await filby.withTransaction((tx) => tx.query('SELECT name, version FROM fby_projection'));

      eq(projections.length, 1);
      deq(projections[0], { name: 'VAT Rates', version: 1 });
    });

    it('should schedule notifications', async (t) => {
      const checkpoint = await getDatabaseTime();
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_HOOK_ADD_PROJECTION, ADD_PROJECTION);

      const { rows: notifications } = await filby.withTransaction((tx) => {
        return tx.query('SELECT * FROM fby_notification ORDER BY id');
      });

      eq(notifications.length, 1);
      assertNotification(notifications[0], {
        hook_name: 'sns/add-projection',
        hook_event: 'ADD_PROJECTION',
        projection_name: 'VAT Rates',
        projection_version: 1,
        scheduled_for: checkpoint,
        attempts: 0,
        status: 'PENDING',
        last_attempted: null,
        last_error: null,
      });
    });

    it('should reject duplicate projection', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, ADD_PROJECTION), (err) => {
        eq(err.message, "Projection 'VAT Rates v1' already exists");
        return true;
      });
    });

    it('should require a name', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_PROJECTION).del('0.name')), (err) => {
        eq(err.message, "001.should-require-a-name.yaml: /0 must have required property 'name'");
        return true;
      });
    });

    it('should require name to be a string', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_PROJECTION).set('0.name', 1)), (err) => {
        eq(err.message, "001.should-require-name-to-be-a-string.yaml: /0/name must be of type 'string'");
        return true;
      });
    });

    it('should escape name', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_PROJECTION).set('0.name', "pwned', 1);RAISE EXCEPTION $💀$You have been pwned!$💀$;"));

      const { rows: projections } = await filby.withTransaction((tx) => tx.query('SELECT name, version FROM fby_projection'));
      eq(projections.length, 1);
      deq(projections[0], { name: "pwned', 1);RAISE EXCEPTION $💀$You have been pwned!$💀$;", version: 1 });
    });

    it('should default version to 1', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_PROJECTION).del('0.version'));

      const { rows: projections } = await filby.withTransaction((tx) => tx.query('SELECT name, version FROM fby_projection'));
      deq(projections, [{ name: 'VAT Rates', version: 1 }]);
    });

    it('should accept entity@version dependency references', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_PROJECTION).set('0.dependencies', [{ entity: 'VAT Rate@1' }]));

      const { rows: entities } = await filby.withTransaction((tx) => tx.query(`
        SELECT e.name, e.version FROM fby_projection p
        INNER JOIN fby_projection_entity pe ON p.id = pe.projection_id
        INNER JOIN fby_entity e ON e.id = pe.entity_id
      `));
      deq(entities, [{ name: 'VAT Rate', version: 1 }]);
    });

    it('should require entity@version dependency references to exist', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_PROJECTION).set('0.dependencies', [{ entity: 'VAT Rate@2' }])), (err) => {
        eq(err.message, "Projection 'VAT Rates v1' references a non existent entity 'VAT Rate v2'; existing entities are 'VAT Rate v1'");
        return true;
      });
    });

    it('should reject dependency references that also specify a version', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_PROJECTION).set('0.dependencies.0.entity', 'VAT Rate@1')), (err) => {
        eq(err.message, "Reference 'VAT Rate@1' must not also specify a version");
        return true;
      });
    });

    it('should require version to be an integer', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_PROJECTION).set('0.version', 1.1)), (err) => {
        eq(err.message, "001.should-require-version-to-be-an-integer.yaml: /0/version must be of type 'integer'");
        return true;
      });
    });

    it('should require at least one dependency', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_PROJECTION).del('0.dependencies')), (err) => {
        eq(err.message, "001.should-require-at-least-one-dependency.yaml: /0 must have required property 'dependencies'");
        return true;
      });

      await rejects(() => filby.applyYaml(t.name, transform(ADD_PROJECTION).set('0.dependencies', 1)), (err) => {
        eq(err.message, "001.should-require-at-least-one-dependency.yaml: /0/dependencies must be of type 'array'");
        return true;
      });

      await rejects(() => filby.applyYaml(t.name, transform(ADD_PROJECTION).set('0.dependencies', [])), (err) => {
        eq(err.message, '001.should-require-at-least-one-dependency.yaml: /0/dependencies must NOT have fewer than 1 items');
        return true;
      });
    });

    it('should require dependencies to reference an entity', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_PROJECTION).del('0.dependencies.0.entity')), (err) => {
        eq(err.message, "001.should-require-dependencies-to-reference-an-entity.yaml: /0/dependencies/0 must have required property 'entity'");
        return true;
      });
    });

    it('should require dependency entity to be a string', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_PROJECTION).set('0.dependencies.0.entity', 1)), (err) => {
        eq(err.message, "001.should-require-dependency-entity-to-be-a-string.yaml: /0/dependencies/0/entity must be of type 'string'");
        return true;
      });
    });

    it('should escape dependency entity', async (t) => {
      await filby.applyYaml(
        t.name,
        transform(ADD_ENTITY).set('0.name', "pwned', 1);RAISE EXCEPTION $💀$You have been pwned!$💀$;"),
        transform(ADD_PROJECTION).set('0.dependencies.0.entity', "pwned', 1);RAISE EXCEPTION $💀$You have been pwned!$💀$;"),
      );

      const { rows: entities } = await filby.withTransaction((tx) => tx.query(`
        SELECT e.name, e.version FROM fby_projection p
        INNER JOIN fby_projection_entity pe ON p.id = pe.projection_id
        INNER JOIN fby_entity e ON e.id = pe.entity_id
      `));

      eq(entities.length, 1);
      deq(entities[0], { name: "pwned', 1);RAISE EXCEPTION $💀$You have been pwned!$💀$;", version: 1 });
    });

    it('should require dependency entity to exist', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_PROJECTION).set('0.dependencies.0.entity', 'wombat')), (err) => {
        eq(err.message, "Projection 'VAT Rates v1' references a non existent entity 'wombat v1'; existing entities are 'VAT Rate v1'");
        return true;
      });
    });

    it('should require dependency entity version to exist', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_PROJECTION).set('0.dependencies.0.version', 2)), (err) => {
        eq(err.message, "Projection 'VAT Rates v1' references a non existent entity 'VAT Rate v2'; existing entities are 'VAT Rate v1'");
        return true;
      });
    });

    it('should require every dependency entity to exist', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_PROJECTION).push('0.dependencies', { entity: 'wombat', version: 1 })), (err) => {
        eq(err.message, "Projection 'VAT Rates v1' references a non existent entity 'wombat v1'; existing entities are 'VAT Rate v1'");
        return true;
      });
    });

    it('should suggest a dependency entity that differs only by case', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_PROJECTION).set('0.dependencies.0.entity', 'vat rate')), (err) => {
        eq(err.message, "Projection 'VAT Rates v1' references a non existent entity 'vat rate v1'; did you mean 'VAT Rate v1'?");
        return true;
      });
    });

    it('should list every existing entity when the dependency entity does not exist', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_ENTITY).set('0.version', 2), transform(ADD_PROJECTION).set('0.dependencies.0.entity', 'wombat')), (err) => {
        eq(err.message, "Projection 'VAT Rates v1' references a non existent entity 'wombat v1'; existing entities are 'VAT Rate v1', 'VAT Rate v2'");
        return true;
      });
    });

    it('should report that no entities exist when the dependency entity does not exist', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_PROJECTION), (err) => {
        eq(err.message, "Projection 'VAT Rates v1' references a non existent entity 'VAT Rate v1'; no entities exist");
        return true;
      });
    });

    it('should require dependencies to have a version', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_PROJECTION).del('0.dependencies.0.version')), (err) => {
        eq(err.message, "001.should-require-dependencies-to-have-a-version.yaml: /0/dependencies/0 must have required property 'version'");
        return true;
      });
    });

    it('should require dependencies version to be an integer', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_PROJECTION).set('0.dependencies.0.version', 1.1)), (err) => {
        eq(err.message, "001.should-require-dependencies-version-to-be-an-integer.yaml: /0/dependencies/0/version must be of type 'integer'");
        return true;
      });
    });

    it('should forbid additional properties in dependencies', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_PROJECTION).merge('0.dependencies.0', { wombat: 1 })), (err) => {
        eq(err.message, "001.should-forbid-additional-properties-in-dependencies.yaml: /0/dependencies/0 must NOT have additional property 'wombat'");
        return true;
      });
    });

    it('should allow a description', async (t) => {
      await filby.applyYaml(t.name, transform(ADD_ENTITY, ADD_PROJECTION).merge('0.description', 'wombat'));
    });

    it('should require description to be a string', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_PROJECTION).merge('0.description', 1)), (err) => {
        eq(err.message, "001.should-require-description-to-be-a-string.yaml: /0/description must be of type 'string'");
        return true;
      });
    });

    it('should escape description', async (t) => {
      const injection = "pwned');RAISE EXCEPTION $💀$You have been pwned!$💀$;";
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_PROJECTION).set('0.description', injection));

      const { rows: projections } = await filby.withTransaction((tx) => tx.query('SELECT description FROM fby_projection'));
      eq(projections.length, 1);
      deq(projections[0], { description: injection });
    });

    it('should forbid additional properties', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_PROJECTION).merge('0', { wombat: 1 })), (err) => {
        eq(err.message, "001.should-forbid-additional-properties.yaml: /0 must NOT have additional property 'wombat'");
        return true;
      });
    });

    it('should derive the dependencies of a root projection', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);

      const projection = await filby.getProjection('VAT Rates', 1);
      const changeLog = await filby.getChangeLog(projection);
      eq(changeLog.length, 1);
      eq(changeLog[0].description, '2020 VAT Rates');
    });

    it('should require the root entity to exist', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ROOT_PROJECTION), (err) => {
        eq(err.message, "Projection 'VAT Rates v1' references a non existent entity 'VAT Rate v1'; no entities exist");
        return true;
      });
    });

    it('should require root to name a version', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ROOT_PROJECTION).set('0.root', 'VAT Rate')), (err) => {
        eq(err.message, '001.should-require-root-to-name-a-version.yaml: /0/root must match pattern "@[0-9]+$"');
        return true;
      });
    });

    it('should reject root together with dependencies', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_PROJECTION).set('0.root', 'VAT Rate@1')), (err) => {
        eq(err.message, "Projection 'VAT Rates' must specify either 'root' or 'dependencies', not both");
        return true;
      });
    });

    it('should require root to use parameters, order or paging', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_PROJECTION).set('0.parameters', { type: { field: 'type' } })), (err) => {
        eq(err.message, "Projection 'VAT Rates' must specify 'root' to use 'parameters'");
        return true;
      });

      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_PROJECTION).set('0.order', [{ field: 'type' }])), (err) => {
        eq(err.message, "Projection 'VAT Rates' must specify 'root' to use 'order'");
        return true;
      });

      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_PROJECTION).set('0.paging', { page_size: 10, page_max: 100 })), (err) => {
        eq(err.message, "Projection 'VAT Rates' must specify 'root' to use 'paging'");
        return true;
      });
    });

    it('should return root rows in the declared order', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);

      const rows = await getProjectionRows('p_page_size => 3');
      deq(rows, [
        { type: 'zero', rate: '0', fby_total: 3 },
        { type: 'reduced', rate: '0.05', fby_total: 3 },
        { type: 'standard', rate: '0.1', fby_total: 3 },
      ]);
    });

    it('should order root rows by the entity key when no order is declared', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_ROOT_PROJECTION).del('0.order'), ADD_CHANGE_SET_1);

      const rows = await getProjectionRows('p_page_size => 3');
      deq(rows.map((row) => row.type), ['reduced', 'standard', 'zero']);
    });

    it('should return every root field without parameters or paging', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(transform(transform(ADD_ROOT_PROJECTION).del('0.parameters')).del('0.order')).del('0.paging'), ADD_CHANGE_SET_1);

      const rows = await getProjectionRows();
      deq(rows, [
        { type: 'reduced', rate: '0.05' },
        { type: 'standard', rate: '0.1' },
        { type: 'zero', rate: '0' },
      ]);
    });

    it('should filter by equality', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);

      const rows = await getProjectionRows('p_type => $2', ['standard']);
      deq(rows.map((row) => row.type), ['standard']);
    });

    it('should filter by prefix', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);

      const rows = await getProjectionRows('p_prefix => $2', ['st']);
      deq(rows.map((row) => row.type), ['standard']);
    });

    it('should match prefix wildcards literally', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, setRates({ standard: 0.2, super_reduced: 0.05, superb: 0.1 }));

      deq((await getProjectionRows('p_prefix => $2', ['super_'])).map((row) => row.type), ['super_reduced']);
      deq((await getProjectionRows('p_prefix => $2', ['s%'])).map((row) => row.type), []);
      deq((await getProjectionRows('p_prefix => $2', ['_'])).map((row) => row.type), []);
    });

    it('should filter by membership', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);

      const rows = await getProjectionRows('p_types => $2', [['standard', 'zero']]);
      deq(rows.map((row) => row.type), ['zero', 'standard']);
    });

    it('should filter by inclusive range', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);

      deq((await getProjectionRows('p_rate_from => $2', [0.05])).map((row) => row.type), ['reduced', 'standard']);
      deq((await getProjectionRows('p_rate_to => $2', [0.05])).map((row) => row.type), ['zero', 'reduced']);
      deq((await getProjectionRows('p_rate_from => $2, p_rate_to => $3', [0.01, 0.09])).map((row) => row.type), ['reduced']);
    });

    it('should filter by comparison', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);

      deq((await getProjectionRows('p_above => $2', [0.05])).map((row) => row.type), ['standard']);
      deq((await getProjectionRows('p_at_least => $2', [0.05])).map((row) => row.type), ['reduced', 'standard']);
      deq((await getProjectionRows('p_below => $2', [0.05])).map((row) => row.type), ['zero']);
      deq((await getProjectionRows('p_at_most => $2', [0.05])).map((row) => row.type), ['zero', 'reduced']);
    });

    it('should ignore null comparison arguments', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);

      const rows = await getProjectionRows('p_above => NULL, p_at_least => NULL, p_below => NULL, p_at_most => NULL, p_page_size => 3');
      deq(rows.map((row) => row.type), ['zero', 'reduced', 'standard']);
    });

    it('should combine parameters on the same field', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);

      const rows = await getProjectionRows('p_above => $2, p_at_most => $3', [0, 0.05]);
      deq(rows.map((row) => row.type), ['reduced']);
    });

    it('should page root rows with the total', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);

      deq(await getProjectionRows(), [
        { type: 'zero', rate: '0', fby_total: 3 },
        { type: 'reduced', rate: '0.05', fby_total: 3 },
      ]);
      deq(await getProjectionRows('p_page_offset => 2'), [
        { type: 'standard', rate: '0.1', fby_total: 3 },
      ]);
      deq(await getProjectionRows('p_page_offset => 3'), []);
    });

    it('should count only the rows that match the parameters', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, ADD_CHANGE_SET_1);

      deq(await getProjectionRows('p_prefix => $2, p_page_size => 1', ['s']), [
        { type: 'standard', rate: '0.1', fby_total: 1 },
      ]);
    });

    it('should clamp the page size to the declared maximum', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, setRates({ a: 0.1, b: 0.2, c: 0.3, d: 0.4, e: 0.5 }));

      const rows = await getProjectionRows('p_page_size => 10');
      deq(rows.map((row) => row.type), ['a', 'b', 'c']);
      eq(rows[0].fby_total, 5);
    });

    it('should record the root, parameters, order and paging', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION);

      const { rows: projections } = await filby.withTransaction((tx) => tx.query(`
        SELECT e.name AS root, e.version AS root_version, p.page_size, p.page_max
        FROM fby_projection p
        INNER JOIN fby_entity e ON e.id = p.root_entity_id
      `));
      deq(projections, [{ root: 'VAT Rate', root_version: 1, page_size: 2, page_max: 3 }]);

      const { rows: parameters } = await filby.withTransaction((tx) => tx.query('SELECT position, name, field, match FROM fby_projection_parameter ORDER BY position'));
      deq(parameters, [
        { position: 1, name: 'type', field: 'type', match: 'equals' },
        { position: 2, name: 'prefix', field: 'type', match: 'prefix' },
        { position: 3, name: 'types', field: 'type', match: 'in' },
        { position: 4, name: 'rate', field: 'rate', match: 'range' },
        { position: 5, name: 'above', field: 'rate', match: 'gt' },
        { position: 6, name: 'at_least', field: 'rate', match: 'gte' },
        { position: 7, name: 'below', field: 'rate', match: 'lt' },
        { position: 8, name: 'at_most', field: 'rate', match: 'lte' },
      ]);

      const { rows: order } = await filby.withTransaction((tx) => tx.query('SELECT position, field, direction, nulls FROM fby_projection_order ORDER BY position'));
      deq(order, [{ position: 1, field: 'rate', direction: 'ASC', nulls: null }]);
    });

    it('should canonicalise parameter and order fields', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(transform(ADD_ROOT_PROJECTION).set('0.parameters.type.field', 'Type')).set('0.order', [{ field: 'Rate' }]), ADD_CHANGE_SET_1);

      const rows = await getProjectionRows('p_type => $2', ['standard']);
      deq(rows.map((row) => row.type), ['standard']);
    });

    it('should reject a parameter on a field the root entity does not have', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_ROOT_PROJECTION).set('0.parameters.type.field', 'wombat')), (err) => {
        eq(err.message, "Projection 'VAT Rates v1' parameter 'type' references a non existent field 'wombat' of entity 'VAT Rate v1'; existing fields are 'type', 'rate'");
        return true;
      });
    });

    it('should reject an order on a field the root entity does not have', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_ROOT_PROJECTION).set('0.order', [{ field: 'wombat' }])), (err) => {
        eq(err.message, "Projection 'VAT Rates v1' orders by a non existent field 'wombat' of entity 'VAT Rate v1'; existing fields are 'type', 'rate'");
        return true;
      });
    });

    it('should order root rows descending', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_ROOT_PROJECTION).set('0.order', [{ field: 'rate', direction: 'DESC' }]), ADD_CHANGE_SET_1);

      const rows = await getProjectionRows('p_page_size => 3');
      deq(rows.map((row) => row.type), ['standard', 'reduced', 'zero']);
    });

    it('should order root rows by a mix of ascending and descending fields', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_ROOT_PROJECTION).set('0.order', [{ field: 'rate', direction: 'DESC' }, { field: 'type', direction: 'ASC' }]), setRates({ a: 0.1, b: 0.2, c: 0.1 }));

      const rows = await getProjectionRows('p_page_size => 3');
      deq(rows.map((row) => row.type), ['b', 'a', 'c']);
    });

    it('should order nulls first or last', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_ROOT_PROJECTION).set('0.order', [{ field: 'rate', nulls: 'FIRST' }]), setRates({ a: 0.1, b: null, c: 0.2 }));
      deq((await getProjectionRows('p_page_size => 3')).map((row) => row.type), ['b', 'a', 'c']);

      await filby.wipe();

      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_ROOT_PROJECTION).set('0.order', [{ field: 'rate', direction: 'DESC', nulls: 'LAST' }]), setRates({ a: 0.1, b: null, c: 0.2 }));
      deq((await getProjectionRows('p_page_size => 3')).map((row) => row.type), ['c', 'a', 'b']);
    });

    it('should record the order direction and nulls', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_ROOT_PROJECTION).set('0.order', [{ field: 'rate', direction: 'DESC', nulls: 'LAST' }, { field: 'type' }]));

      const { rows: order } = await filby.withTransaction((tx) => tx.query('SELECT position, field, direction, nulls FROM fby_projection_order ORDER BY position'));
      deq(order, [
        { position: 1, field: 'rate', direction: 'DESC', nulls: 'LAST' },
        { position: 2, field: 'type', direction: 'ASC', nulls: null },
      ]);
    });

    it('should require order items to be objects', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ROOT_PROJECTION).set('0.order', ['rate'])), (err) => {
        eq(err.message, "001.should-require-order-items-to-be-objects.yaml: /0/order/0 must be of type 'object'");
        return true;
      });
    });

    it('should require order items to have a field', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ROOT_PROJECTION).set('0.order', [{ direction: 'ASC' }])), (err) => {
        eq(err.message, "001.should-require-order-items-to-have-a-field.yaml: /0/order/0 must have required property 'field'");
        return true;
      });
    });

    it('should require order direction to be ASC or DESC', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ROOT_PROJECTION).set('0.order', [{ field: 'rate', direction: 'desc' }])), (err) => {
        eq(err.message, "001.should-require-order-direction-to-be-asc-or-desc.yaml: /0/order/0/direction must be equal to one of the allowed values 'ASC' or 'DESC'");
        return true;
      });
    });

    it('should require order nulls to be FIRST or LAST', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ROOT_PROJECTION).set('0.order', [{ field: 'rate', nulls: 'wombat' }])), (err) => {
        eq(err.message, "001.should-require-order-nulls-to-be-first-or-last.yaml: /0/order/0/nulls must be equal to one of the allowed values 'FIRST' or 'LAST'");
        return true;
      });
    });

    it('should reject reserved parameter names', async (t) => {
      for (const name of ['change_set_id', 'page_offset', 'Page Size']) {
        await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_ROOT_PROJECTION).set('0.parameters', { [name]: { field: 'type' } })), (err) => {
          eq(err.message, `Projection 'VAT Rates v1' parameter '${name}' uses a reserved name`);
          return true;
        });
      }
    });

    it('should escape parameter names', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_ROOT_PROJECTION).set('0.parameters', { 'pwned" INTEGER); RAISE EXCEPTION $💀$You have been pwned!$💀$; --': { field: 'type' } }), ADD_CHANGE_SET_1);

      ok(await hasFunction('get_vat_rates_v1'));
    });

    it('should require parameters to have a field', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ROOT_PROJECTION).del('0.parameters.type.field')), (err) => {
        eq(err.message, "001.should-require-parameters-to-have-a-field.yaml: /0/parameters/type must have required property 'field'");
        return true;
      });
    });

    it('should require parameter match to be a known operator', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ROOT_PROJECTION).set('0.parameters.type.match', 'wombat')), (err) => {
        eq(err.message, "001.should-require-parameter-match-to-be-a-known-operator.yaml: /0/parameters/type/match must be equal to one of the allowed values 'equals', 'prefix', 'in', 'range', 'gt', 'gte', 'lt' or 'lte'");
        return true;
      });
    });

    it('should require paging to have a positive size and max', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ROOT_PROJECTION).del('0.paging.page_max')), (err) => {
        eq(err.message, "001.should-require-paging-to-have-a-positive-size-and-max.yaml: /0/paging must have required property 'page_max'");
        return true;
      });

      await rejects(() => filby.applyYaml(t.name, transform(ADD_ROOT_PROJECTION).set('0.paging.page_size', 0)), (err) => {
        eq(err.message, '001.should-require-paging-to-have-a-positive-size-and-max.yaml: /0/paging/page_size must be >= 1');
        return true;
      });
    });

    it('should nest child entities in the declared order', async (t) => {
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, ADD_NESTED_PROJECTION, ADD_PARK_CHANGE_SET);

      const { documents, total } = await getDocuments({ pageSize: 3 });
      eq(total, 3);
      deq(documents, [
        {
          code: 'DC',
          name: 'Devon Cliffs',
          seasons: [
            { type: 'Guests', start: new Date('2019-03-15T00:00:00Z'), end: new Date('2019-11-15T00:00:00Z') },
            { type: 'Owners', start: new Date('2019-03-01T00:00:00Z'), end: new Date('2019-11-30T00:00:00Z') },
            { type: 'Guests', start: new Date('2019-02-01T00:00:00Z'), end: new Date('2019-02-28T00:00:00Z') },
          ],
        },
        { code: 'GA', name: 'Greenacres', seasons: [] },
        { code: 'PV', name: 'Primrose Valley', seasons: [{ type: 'Guests', start: new Date('2019-03-15T00:00:00Z'), end: new Date('2019-11-15T00:00:00Z') }] },
      ]);
    });

    it('should order nested entities by their entity key when no nest order is declared', async (t) => {
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, transform(ADD_NESTED_PROJECTION).del('0.nest.seasons.order'), ADD_PARK_CHANGE_SET);

      const { documents } = await getDocuments({ parameters: { code: 'DC' } });
      deq(documents[0].seasons.map(({ type, start }) => `${type} ${start.toISOString()}`), ['Guests 2019-02-01T00:00:00.000Z', 'Guests 2019-03-15T00:00:00.000Z', 'Owners 2019-03-01T00:00:00.000Z']);
    });

    it('should nest child entities without parameters or paging', async (t) => {
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, transform(transform(transform(ADD_NESTED_PROJECTION).del('0.parameters')).del('0.order')).del('0.paging'), ADD_PARK_CHANGE_SET);

      const { documents, total } = await getDocuments({ pageOffset: 1, pageSize: 1 });
      eq(total, 3);
      deq(documents.map((document) => document.code), ['DC', 'GA', 'PV']);
      deq(Object.keys(documents[0]), ['code', 'name', 'seasons']);
      eq(documents[0].seasons.length, 3);
    });

    it('should page root rows with all their nested entities', async (t) => {
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, ADD_NESTED_PROJECTION, ADD_PARK_CHANGE_SET);

      const page1 = await getDocuments();
      eq(page1.total, 3);
      deq(page1.documents.map((document) => [document.code, document.seasons.length]), [['DC', 3], ['GA', 0]]);

      const page2 = await getDocuments({ pageOffset: 2 });
      eq(page2.total, 3);
      deq(page2.documents.map((document) => [document.code, document.seasons.length]), [['PV', 1]]);

      const page3 = await getDocuments({ pageOffset: 3 });
      eq(page3.total, 0);
      deq(page3.documents, []);
    });

    it('should filter root rows by parameters without filtering their nested entities', async (t) => {
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, ADD_NESTED_PROJECTION, ADD_PARK_CHANGE_SET);

      const { documents, total } = await getDocuments({ parameters: { code: 'DC' } });
      eq(total, 1);
      deq(documents.map((document) => [document.code, document.seasons.length]), [['DC', 3]]);
    });

    it('should nest more than one entity', async (t) => {
      const nest = { seasons: { entity: 'season@1', on: { park_code: 'code' } }, guests: { entity: 'season@1', on: { park_code: 'code', type: 'name' } } };
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, transform(ADD_NESTED_PROJECTION).set('0.nest', nest), ADD_PARK_CHANGE_SET);

      const { documents } = await getDocuments({ parameters: { code: 'DC' } });
      deq(Object.keys(documents[0]), ['code', 'name', 'seasons', 'guests']);
      eq(documents[0].seasons.length, 3);
      deq(documents[0].guests, []);
    });

    it('should nest child entities under every root row they join to', async (t) => {
      const nest = { seasons: { entity: 'season@1', on: { type: 'name' } } };
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, transform(ADD_NESTED_PROJECTION).set('0.nest', nest), transform(ADD_PARK_CHANGE_SET).set('0.changes.0.data', [{ code: 'DC', name: 'Guests' }, { code: 'PV', name: 'Guests' }]));

      const { documents } = await getDocuments();
      deq(documents.map((document) => [document.code, document.seasons.map((season) => season.park_code)]), [['DC', ['DC', 'DC', 'PV']], ['PV', ['DC', 'DC', 'PV']]]);
    });

    it('should return nested and root values of the same type identically', async (t) => {
      await filby.applyYaml(t.name, transform(ADD_PARK_ENTITIES).set('0.fields.opened', 'TIMESTAMP WITH TIME ZONE'), ADD_NESTED_PROJECTION, transform(ADD_PARK_CHANGE_SET).set('0.changes.0.data.0.opened', '2019-03-15T00:00:00Z'));

      const { documents: [park] } = await getDocuments({ parameters: { code: 'DC' } });
      ok(park.opened instanceof Date);
      ok(park.seasons[0].start instanceof Date);
      deq(park.opened, park.seasons[0].start);
    });

    it('should generate a function that returns flat rows', async (t) => {
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, ADD_NESTED_PROJECTION, ADD_PARK_CHANGE_SET);

      const changeSetId = await getChangeSetId('2019 Parks');
      const { rows } = await filby.withTransaction((tx) => tx.query('SELECT * FROM get_parks_v1($1)', [changeSetId]));
      deq(Object.keys(rows[0]), ['code', 'name', 'fby_total']);
    });

    it('should reject documents for a projection without a root', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, ADD_CHANGE_SET_1);

      const projection = await filby.getProjection('VAT Rates', 1);
      const changeSetId = await getChangeSetId('2020 VAT Rates');
      await rejects(() => filby.getDocuments(projection, changeSetId), (err) => {
        eq(err.message, "Projection 'VAT Rates v1' is not declared with a root");
        return true;
      });
    });

    it('should reject documents for an unknown parameter', async (t) => {
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, ADD_NESTED_PROJECTION, ADD_PARK_CHANGE_SET);

      await rejects(() => getDocuments({ parameters: { wombat: 'DC' } }), (err) => {
        eq(err.message, "Projection 'Parks v1' has no parameter 'wombat'; existing parameters are 'code'");
        return true;
      });
    });

    it('should derive the dependencies of nested entities', async (t) => {
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, ADD_NESTED_PROJECTION, ADD_PARK_CHANGE_SET, ADD_SEASON_CHANGE_SET);

      const projection = await filby.getProjection('Parks', 1);
      const changeLog = await filby.getChangeLog(projection);
      deq(changeLog.map((changeSet) => changeSet.description), ['2019 Parks', '2020 Seasons']);
    });

    it('should record the nested entities', async (t) => {
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, ADD_NESTED_PROJECTION);

      const { rows: nests } = await filby.withTransaction((tx) => tx.query(`
        SELECT n.position, n.name, e.name AS entity, e.version
        FROM fby_projection_nest n
        INNER JOIN fby_entity e ON e.id = n.entity_id
        ORDER BY n.position
      `));
      deq(nests, [{ position: 1, name: 'seasons', entity: 'season', version: 1 }]);

      const { rows: joins } = await filby.withTransaction((tx) => tx.query('SELECT position, field, root_field FROM fby_projection_nest_on ORDER BY position'));
      deq(joins, [{ position: 1, field: 'park_code', root_field: 'code' }]);

      const { rows: order } = await filby.withTransaction((tx) => tx.query('SELECT position, field, direction, nulls FROM fby_projection_nest_order ORDER BY position'));
      deq(order, [
        { position: 1, field: 'start', direction: 'DESC', nulls: null },
        { position: 2, field: 'type', direction: 'ASC', nulls: null },
      ]);
    });

    it('should canonicalise nest names and fields', async (t) => {
      const nest = { 'Park Seasons': { entity: 'season@1', on: { 'Park Code': 'Code' }, order: [{ field: 'Start' }] } };
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, transform(ADD_NESTED_PROJECTION).set('0.nest', nest), ADD_PARK_CHANGE_SET);

      const { documents } = await getDocuments({ parameters: { code: 'DC' } });
      deq(documents[0].park_seasons.map((season) => season.start.toISOString()), ['2019-02-01T00:00:00.000Z', '2019-03-01T00:00:00.000Z', '2019-03-15T00:00:00.000Z']);
    });

    it('should require root to use nest', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_PROJECTION).set('0.nest', { seasons: { entity: 'season@1', on: { park_code: 'code' } } })), (err) => {
        eq(err.message, "Projection 'VAT Rates' must specify 'root' to use 'nest'");
        return true;
      });
    });

    it('should require the nested entity to exist', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_PARK_ENTITIES, transform(ADD_NESTED_PROJECTION).set('0.nest.seasons.entity', 'Season@2')), (err) => {
        eq(err.message, "Projection 'Parks v1' references a non existent entity 'Season v2'; existing entities are 'park v1', 'season v1'");
        return true;
      });
    });

    it('should reject a nest join on a field the nested entity does not have', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_PARK_ENTITIES, transform(ADD_NESTED_PROJECTION).set('0.nest.seasons.on', { wombat: 'code' })), (err) => {
        eq(err.message, "Projection 'Parks v1' nest 'seasons' joins on a non existent field 'wombat' of entity 'season v1'; existing fields are 'park_code', 'type', 'start', 'end'");
        return true;
      });
    });

    it('should reject a nest join on a field the root entity does not have', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_PARK_ENTITIES, transform(ADD_NESTED_PROJECTION).set('0.nest.seasons.on', { park_code: 'wombat' })), (err) => {
        eq(err.message, "Projection 'Parks v1' nest 'seasons' joins on a non existent field 'wombat' of entity 'park v1'; existing fields are 'code', 'name'");
        return true;
      });
    });

    it('should reject a nest order on a field the nested entity does not have', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_PARK_ENTITIES, transform(ADD_NESTED_PROJECTION).set('0.nest.seasons.order', [{ field: 'wombat' }])), (err) => {
        eq(err.message, "Projection 'Parks v1' nest 'seasons' orders by a non existent field 'wombat' of entity 'season v1'; existing fields are 'park_code', 'type', 'start', 'end'");
        return true;
      });
    });

    it('should reject a nest with the same name as a root field', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_PARK_ENTITIES, transform(ADD_NESTED_PROJECTION).set('0.nest', { Name: { entity: 'season@1', on: { park_code: 'code' } } })), (err) => {
        eq(err.message, "Projection 'Parks v1' nest 'Name' has the same name as a field of entity 'park v1'");
        return true;
      });
    });

    it('should reject a nest with a reserved name', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_PARK_ENTITIES, transform(ADD_NESTED_PROJECTION).set('0.nest', { fby_total: { entity: 'season@1', on: { park_code: 'code' } } })), (err) => {
        eq(err.message, "Projection 'Parks v1' nest 'fby_total' uses a reserved name");
        return true;
      });
    });

    it('should reject nests with the same canonical name', async (t) => {
      const nest = { Seasons: { entity: 'season@1', on: { park_code: 'code' } }, seasons: { entity: 'season@1', on: { park_code: 'code' } } };
      await rejects(() => filby.applyYaml(t.name, ADD_PARK_ENTITIES, transform(ADD_NESTED_PROJECTION).set('0.nest', nest)), (err) => {
        eq(err.message, "Projection 'Parks v1' declares nest 'seasons' more than once");
        return true;
      });

      const { rows: projections } = await filby.withTransaction((tx) => tx.query('SELECT * FROM fby_projection'));
      eq(projections.length, 0);
    });

    it('should require nest entries to have an entity', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_NESTED_PROJECTION).del('0.nest.seasons.entity')), (err) => {
        eq(err.message, "001.should-require-nest-entries-to-have-an-entity.yaml: /0/nest/seasons must have required property 'entity'");
        return true;
      });
    });

    it('should require nest entity to name a version', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_NESTED_PROJECTION).set('0.nest.seasons.entity', 'season')), (err) => {
        eq(err.message, '001.should-require-nest-entity-to-name-a-version.yaml: /0/nest/seasons/entity must match pattern "@[0-9]+$"');
        return true;
      });
    });

    it('should require nest entries to have a join', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_NESTED_PROJECTION).del('0.nest.seasons.on')), (err) => {
        eq(err.message, "001.should-require-nest-entries-to-have-a-join.yaml: /0/nest/seasons must have required property 'on'");
        return true;
      });

      await rejects(() => filby.applyYaml(t.name, transform(ADD_NESTED_PROJECTION).set('0.nest.seasons.on', {})), (err) => {
        eq(err.message, '001.should-require-nest-entries-to-have-a-join.yaml: /0/nest/seasons/on must NOT have fewer than 1 properties');
        return true;
      });
    });

    it('should require nest join fields to be strings', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_NESTED_PROJECTION).set('0.nest.seasons.on', { park_code: 1 })), (err) => {
        eq(err.message, "001.should-require-nest-join-fields-to-be-strings.yaml: /0/nest/seasons/on/park_code must be of type 'string'");
        return true;
      });
    });

    it('should require nest order items to be objects', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_NESTED_PROJECTION).set('0.nest.seasons.order', ['start'])), (err) => {
        eq(err.message, "001.should-require-nest-order-items-to-be-objects.yaml: /0/nest/seasons/order/0 must be of type 'object'");
        return true;
      });
    });

    it('should forbid additional properties in nest entries', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_NESTED_PROJECTION).merge('0.nest.seasons', { wombat: 1 })), (err) => {
        eq(err.message, "001.should-forbid-additional-properties-in-nest-entries.yaml: /0/nest/seasons must NOT have additional property 'wombat'");
        return true;
      });
    });

    function setRates(rates) {
      const data = Object.entries(rates).map(([type, rate]) => ({ type, rate }));
      return transform(ADD_CHANGE_SET_1).set('0.frames', [{ entity: 'VAT Rate', version: 1, action: 'SET', data }]);
    }

    async function getProjectionRows(args = '', values = []) {
      const changeSetId = await getChangeSetId('2020 VAT Rates');
      const { rows } = await filby.withTransaction((tx) => tx.query(`SELECT * FROM get_vat_rates_v1($1${args ? `, ${args}` : ''})`, [changeSetId, ...values]));
      return rows;
    }

    async function getDocuments(options) {
      const projection = await filby.getProjection('Parks', 1);
      const changeSetId = await getChangeSetId('2019 Parks');
      return filby.getDocuments(projection, changeSetId, options);
    }
  });

  describe('Drop Projection', () => {

    it('should drop the generated function', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_ROOT_PROJECTION, DROP_PROJECTION);
      ok(!await hasFunction('get_vat_rates_v1'));
    });

    it('should drop a nested projection with its nested entities', async (t) => {
      await filby.applyYaml(t.name, ADD_PARK_ENTITIES, ADD_NESTED_PROJECTION, transform(DROP_PROJECTION).set('0.name', 'Parks'));
      ok(!await hasFunction('get_parks_v1'));

      const { rows: nests } = await filby.withTransaction((tx) => tx.query('SELECT * FROM fby_projection_nest'));
      eq(nests.length, 0);

      await filby.applyYaml(t.name, ADD_NESTED_PROJECTION);
      ok(await hasFunction('get_parks_v1'));
    });

    it('should leave a hand written function with the same name in place', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION);
      await filby.withTransaction((tx) => tx.query('CREATE FUNCTION get_vat_rates_v1(p_change_set_id INTEGER) RETURNS INTEGER AS $$ SELECT 1 $$ LANGUAGE sql STABLE'));

      await filby.applyYaml(t.name, DROP_PROJECTION);
      ok(await hasFunction('get_vat_rates_v1'));
    });

    it('should drop projection', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, DROP_PROJECTION);
      const { rows: projections } = await filby.withTransaction((tx) => tx.query('SELECT * FROM fby_projection'));
      eq(projections.length, 0);
    });

    it('should schedule notifications', async (t) => {
      const checkpoint = await getDatabaseTime();
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, ADD_HOOK_DROP_PROJECTION, DROP_PROJECTION);

      const { rows: notifications } = await filby.withTransaction((tx) => {
        return tx.query('SELECT * FROM fby_notification ORDER BY id');
      });

      eq(notifications.length, 1);
      assertNotification(notifications[0], {
        hook_name: 'sns/drop-projection',
        hook_event: 'DROP',
        projection_name: 'VAT Rates',
        projection_version: 1,
        scheduled_for: checkpoint,
        attempts: 0,
        status: 'PENDING',
        last_attempted: null,
        last_error: null,
      });
    });

    it('should delete notifications', async (t) => {
      await filby.applyYaml(
        t.name,
        ADD_ENTITY,
        ADD_HOOK_ADD_PROJECTION,
        ADD_PROJECTION,
        ADD_HOOK_CHANGE_SET_GENERAL,
        ADD_HOOK_CHANGE_SET_PROJECTION,
        ADD_CHANGE_SET_1,
        ADD_HOOK_DROP_PROJECTION,
      );

      const countBefore = await countNotifications();
      eq(countBefore, 3);

      await filby.applyYaml(t.name, DROP_PROJECTION);

      const countAfter = await countNotifications();
      // -1 for deletion of the CHANGE_SET_PROJECTION notification via cascade
      // -1 for deletion of the CHANGE_SET_GENERAL manual
      // -1 for deletion of the ADD_PROJECTION manual
      // +1 for the DROP_PROJECTION notification
      eq(countAfter, 1);
    });

    it('should ignore other projections', async (t) => {
      const ADD_ANOTHER_PROJETION = `
- operation: ADD_PROJECTION
  name: VAT Rates
  version: 2
  dependencies:
  - entity: VAT Rate
    version: 1
`;
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, ADD_ANOTHER_PROJETION, DROP_PROJECTION);
      const { rows: projections } = await filby.withTransaction((tx) => tx.query('SELECT * FROM fby_projection'));
      eq(projections.length, 1);
    });

    it('should require a name', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(DROP_PROJECTION).del('0.name')), (err) => {
        eq(err.message, "001.should-require-a-name.yaml: /0 must have required property 'name'");
        return true;
      });
    });

    it('should require name to be a string', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(DROP_PROJECTION).set('0.name', 1)), (err) => {
        eq(err.message, "001.should-require-name-to-be-a-string.yaml: /0/name must be of type 'string'");
        return true;
      });
    });

    it('should escape name', async (t) => {
      await filby.applyYaml(
        t.name,
        ADD_ENTITY,
        transform(ADD_PROJECTION).set('0.name', "pwned', 1);RAISE EXCEPTION $💀$You have been pwned!$💀$;"),
        transform(DROP_PROJECTION).set('0.name', "pwned', 1);RAISE EXCEPTION $💀$You have been pwned!$💀$;"),
      );

      const { rows: projections } = await filby.withTransaction((tx) => tx.query('SELECT name, version FROM fby_projection'));
      eq(projections.length, 0);
    });

    it('should require a version', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(DROP_PROJECTION).del('0.version')), (err) => {
        eq(err.message, "001.should-require-a-version.yaml: /0 must have required property 'version'");
        return true;
      });
    });

    it('should require version to be an integer', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(DROP_PROJECTION).set('0.version', 1.1)), (err) => {
        eq(err.message, "001.should-require-version-to-be-an-integer.yaml: /0/version must be of type 'integer'");
        return true;
      });
    });

    it('should report missing projections', async (t) => {
      await rejects(() => filby.applyYaml(t.name, DROP_PROJECTION), (err) => {
        eq(err.message, "Projection 'VAT Rates v1' does not exist");
        return true;
      });
    });

    it('should allow a description', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, transform(DROP_PROJECTION).merge('0.description', 'wombat'));
    });

    it('should require description to be a string', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(DROP_PROJECTION).merge('0.description', 1)), (err) => {
        eq(err.message, "001.should-require-description-to-be-a-string.yaml: /0/description must be of type 'string'");
        return true;
      });
    });

    it('should forbid additional properties', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(DROP_PROJECTION).merge('0', { wombat: 1 })), (err) => {
        eq(err.message, "001.should-forbid-additional-properties.yaml: /0 must NOT have additional property 'wombat'");
        return true;
      });
    });
  });

  describe('Add Change Set', () => {

    it('should add a change set', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_CHANGE_SET_1);

      const frames = await getDataFrames('2020 VAT Rates');
      eq(frames.length, 3);
      deq(frames[0], {
        description: '2020 VAT Rates',
        effective: new Date('2020-04-05T00:00:00.000Z'),
        entity: 'VAT Rate',
        version: 1,
        action: 'SET',
        type: 'standard',
        rate: 0.10,
      });
    });

    it('should schedule notifications', async (t) => {
      const checkpoint = await getDatabaseTime();
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, ADD_HOOK_CHANGE_SET_PROJECTION, ADD_HOOK_CHANGE_SET_GENERAL, ADD_CHANGE_SET_1);

      const { rows: notifications } = await filby.withTransaction((tx) => {
        return tx.query('SELECT * FROM fby_notification ORDER BY id');
      });

      eq(notifications.length, 2);
      assertNotification(notifications[0], {
        hook_name: 'sns/add-change-set/vat-rates-v1',
        hook_event: 'ADD_CHANGE_SET',
        projection_name: 'VAT Rates',
        projection_version: 1,
        scheduled_for: checkpoint,
        attempts: 0,
        status: 'PENDING',
        last_attempted: null,
        last_error: null,
      });

      assertNotification(notifications[1], {
        hook_name: 'sns/add-change-set/*',
        hook_event: 'ADD_CHANGE_SET',
        projection_name: 'VAT Rates',
        projection_version: 1,
        scheduled_for: checkpoint,
        attempts: 0,
        status: 'PENDING',
        last_attempted: null,
        last_error: null,
      });
    });

    it('should require a description', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).del('0.description')), (err) => {
        eq(err.message, "001.should-require-a-description.yaml: /0 must have required property 'description'");
        return true;
      });
    });

    it('should require description to be a string', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).set('0.description', 1)), (err) => {
        eq(err.message, "001.should-require-description-to-be-a-string.yaml: /0/description must be of type 'string'");
        return true;
      });
    });

    it('should escape description', async (t) => {
      const injection = "pwned', 1);RAISE EXCEPTION $💀$You have been pwned!$💀$;";
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_CHANGE_SET_1).set('0.description', injection));

      const frames = await getDataFrames(injection);
      eq(frames.length, 3);
      deq(frames[0], {
        description: injection,
        effective: new Date('2020-04-05T00:00:00.000Z'),
        entity: 'VAT Rate',
        version: 1,
        action: 'SET',
        type: 'standard',
        rate: 0.10,
      });
    });

    it('should require an effective date', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).del('0.effective')), (err) => {
        eq(err.message, "001.should-require-an-effective-date.yaml: /0 must have required property 'effective'");
        return true;
      });
    });

    it('should require effective to be a string', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).set('0.effective', 1)), (err) => {
        eq(err.message, "001.should-require-effective-to-be-a-string.yaml: /0/effective must be of type 'string'");
        return true;
      });
    });

    it('should require effective to be an ISO Date', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).set('0.effective', 'wombat')), (err) => {
        eq(err.message, "001.should-require-effective-to-be-an-iso-date.yaml: /0/effective must match format 'date-time' or 'date'");
        return true;
      });
    });

    it('should place a bare effective date in the change set timezone', async (t) => {
      await filby.applyYaml(
        t.name,
        ADD_ENTITY,
        transform(ADD_CHANGE_SET_1).merge('0', { description: 'Winter VAT Rates', effective: '2026-01-01', timezone: 'Europe/London' }),
        transform(ADD_CHANGE_SET_1).merge('0', { description: 'Summer VAT Rates', effective: '2026-07-01', timezone: 'Europe/London' }),
      );

      const [winter] = await getDataFrames('Winter VAT Rates');
      eq(winter.effective.toISOString(), '2026-01-01T00:00:00.000Z');

      const [summer] = await getDataFrames('Summer VAT Rates');
      eq(summer.effective.toISOString(), '2026-06-30T23:00:00.000Z');
    });

    it('should require a timezone for a bare effective date', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).set('0.effective', '2026-01-01')), (err) => {
        eq(err.message, "001.should-require-a-timezone-for-a-bare-effective-date.yaml: /0/effective '2026-01-01' is a calendar date in the change set's timezone, but the change set has no timezone. Filby never uses the process timezone, because the same file would render differently on different machines. Add 'timezone' (an IANA name such as 'Europe/London') to the change set, or give 'effective' an explicit offset such as '2026-01-01T00:00:00Z'");
        return true;
      });
    });

    it('should ignore the timezone when effective has an explicit offset', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_CHANGE_SET_1).merge('0', { effective: '2020-04-05T00:00:00.000Z', timezone: 'Europe/London' }));

      const [frame] = await getDataFrames('2020 VAT Rates');
      eq(frame.effective.toISOString(), '2020-04-05T00:00:00.000Z');
    });

    it('should require timezone to be a string', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).merge('0', { effective: '2026-01-01', timezone: 1 })), (err) => {
        eq(err.message, "001.should-require-timezone-to-be-a-string.yaml: /0/timezone must be of type 'string'");
        return true;
      });
    });

    it('should reject an unknown timezone', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_CHANGE_SET_1).merge('0', { effective: '2026-01-01', timezone: 'Mars/Olympus_Mons' })), (err) => {
        eq(err.message, 'time zone "Mars/Olympus_Mons" not recognized');
        return true;
      });
    });

    it('should require at least one frame', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).del('0.frames')), (err) => {
        eq(err.message, "001.should-require-at-least-one-frame.yaml: /0 must have required property 'frames'");
        return true;
      });

      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).set('0.frames', 1)), (err) => {
        eq(err.message, "001.should-require-at-least-one-frame.yaml: /0/frames must be of type 'array'");
        return true;
      });

      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).set('0.frames', [])), (err) => {
        eq(err.message, '001.should-require-at-least-one-frame.yaml: /0/frames must NOT have fewer than 1 items');
        return true;
      });
    });

    it('should accept changes as an equivalent of frames', async (t) => {
      const { 0: { frames, ...changeSet } } = YAML.parse(ADD_CHANGE_SET_1);
      await filby.applyYaml(t.name, ADD_ENTITY, YAML.stringify([{ ...changeSet, changes: frames }]));

      const dataFrames = await getDataFrames('2020 VAT Rates');
      eq(dataFrames.length, 3);
      deq(dataFrames[0], {
        description: '2020 VAT Rates',
        effective: new Date('2020-04-05T00:00:00.000Z'),
        entity: 'VAT Rate',
        version: 1,
        action: 'SET',
        type: 'standard',
        rate: 0.10,
      });
    });

    it('should require at least one change', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(transform(ADD_CHANGE_SET_1).del('0.frames')).set('0.changes', [])), (err) => {
        eq(err.message, '001.should-require-at-least-one-change.yaml: /0/changes must NOT have fewer than 1 items');
        return true;
      });
    });

    it('should reject both frames and changes', async (t) => {
      const { 0: { frames } } = YAML.parse(ADD_CHANGE_SET_1);
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_CHANGE_SET_1).set('0.changes', frames)), (err) => {
        eq(err.message, "Change set '2020 VAT Rates' must specify either 'changes' or 'frames', not both");
        return true;
      });
    });

    it('should accept entity@version frame references', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(transform(ADD_CHANGE_SET_1).del('0.frames.0.version')).set('0.frames.0.entity', 'VAT Rate@1'));

      const frames = await getDataFrames('2020 VAT Rates');
      eq(frames.length, 3);
      deq(frames[0], {
        description: '2020 VAT Rates',
        effective: new Date('2020-04-05T00:00:00.000Z'),
        entity: 'VAT Rate',
        version: 1,
        action: 'SET',
        type: 'standard',
        rate: 0.10,
      });
    });

    it('should accept entity@version frame references for csv sources', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_CHANGE_SET_1).set('0.frames', [{ entity: 'VAT Rate@1', source: '../dsl/datafiles/vat-rate-v1-2020-set.csv' }]));

      const frames = await getDataFrames('2020 VAT Rates');
      eq(frames.length, 3);
      deq(frames.map((frame) => frame.version), [1, 1, 1]);
    });

    it('should require entity@version frame references to exist', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(transform(ADD_CHANGE_SET_1).del('0.frames.1.version')).set('0.frames.1.entity', 'VAT Rate@2')), (err) => {
        eq(err.message, "Change set '2020 VAT Rates' references a non existent entity 'VAT Rate v2'; existing entities are 'VAT Rate v1'");
        return true;
      });
    });

    it('should require frame references to specify a version', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(transform(ADD_CHANGE_SET_1).del('0.frames')).set('0.changes', [{ entity: 'VAT Rate', action: 'SET', data: [{ type: 'standard', rate: 0.1 }] }])), (err) => {
        eq(err.message, "001.should-require-frame-references-to-specify-a-version.yaml: /0/changes/0 must have required property 'version'");
        return true;
      });
    });

    it('should reject frame references that also specify a version', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_CHANGE_SET_1).set('0.frames.0.entity', 'VAT Rate@1')), (err) => {
        eq(err.message, "Reference 'VAT Rate@1' must not also specify a version");
        return true;
      });
    });

    it('should store SET frames as SET', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_CHANGE_SET_1).set('0.frames.0.action', 'SET'));

      const frames = await getDataFrames('2020 VAT Rates');
      deq(frames.map((frame) => frame.action), ['SET', 'SET', 'SET']);
    });

    it('should require frames to specify an entity name', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).del('0.frames.0.entity')), (err) => {
        eq(err.message, "001.should-require-frames-to-specify-an-entity-name.yaml: /0/frames/0 must have required property 'entity'");
        return true;
      });
    });

    it('should require frame entity name to be a string', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).set('0.frames.0.entity', 1)), (err) => {
        eq(err.message, "001.should-require-frame-entity-name-to-be-a-string.yaml: /0/frames/0/entity must be of type 'string'");
        return true;
      });
    });

    it('should escape frame entity name', async (t) => {
      const injection = "pwned', 1);RAISE EXCEPTION $💀$You have been pwned!$💀$;";
      await filby.applyYaml(
        t.name,
        ADD_ENTITY,
        transform(ADD_ENTITY).set('0.name', injection),
        transform(ADD_CHANGE_SET_1).set('0.frames.0.entity', injection),
      );

      const frames = await getDataFrames('2020 VAT Rates', table(injection, 1));
      eq(frames.length, 1);
      deq(frames[0], {
        description: '2020 VAT Rates',
        effective: new Date('2020-04-05T00:00:00.000Z'),
        entity: injection,
        version: 1,
        action: 'SET',
        type: 'standard',
        rate: 0.10,
      });
    });

    it('should require frame entity to exist', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_CHANGE_SET_1).set('0.frames.1.entity', 'wombat')), (err) => {
        eq(err.message, "Change set '2020 VAT Rates' references a non existent entity 'wombat v1'; existing entities are 'VAT Rate v1'");
        return true;
      });
    });

    it('should require frame entity version to exist', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_CHANGE_SET_1).set('0.frames.1.version', 2)), (err) => {
        eq(err.message, "Change set '2020 VAT Rates' references a non existent entity 'VAT Rate v2'; existing entities are 'VAT Rate v1'");
        return true;
      });
    });

    it('should suggest a frame entity that differs only by case', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_CHANGE_SET_1).set('0.frames.1.entity', 'vat rate')), (err) => {
        eq(err.message, "Change set '2020 VAT Rates' references a non existent entity 'vat rate v1'; did you mean 'VAT Rate v1'?");
        return true;
      });
    });

    it('should list every existing entity when the frame entity does not exist', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_ENTITY).set('0.version', 2), transform(ADD_CHANGE_SET_1).set('0.frames.1.entity', 'wombat')), (err) => {
        eq(err.message, "Change set '2020 VAT Rates' references a non existent entity 'wombat v1'; existing entities are 'VAT Rate v1', 'VAT Rate v2'");
        return true;
      });
    });

    it('should report that no entities exist when the frame entity does not exist', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_CHANGE_SET_1), (err) => {
        eq(err.message, "Change set '2020 VAT Rates' references a non existent entity 'VAT Rate v1'; no entities exist");
        return true;
      });
    });

    it('should require frames to specify an entity version', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).del('0.frames.0.version')), (err) => {
        eq(err.message, "001.should-require-frames-to-specify-an-entity-version.yaml: /0/frames/0 must have required property 'version'");
        return true;
      });
    });

    it('should require frame entity version to be an integer', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).set('0.frames.0.version', 'wombat')), (err) => {
        eq(err.message, "001.should-require-frame-entity-version-to-be-an-integer.yaml: /0/frames/0/version must be of type 'integer'");
        return true;
      });
    });

    it('should require frames to specify either an action or a source', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).del('0.frames.0.action')), (err) => {
        eq(err.message, "001.should-require-frames-to-specify-either-an-action-or-a-source.yaml: /0/frames/0 must have required property 'source' or 'action'");
        return true;
      });
    });

    it('should accept lower case frame actions', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(transform(transform(ADD_CHANGE_SET_1).set('0.frames.0.action', 'set')).set('0.frames.1.action', 'delete')).set('0.frames.2.action', 'post'));

      const frames = await getDataFrames('2020 VAT Rates');
      deq(frames.map((frame) => frame.action), ['SET', 'DELETE', 'SET']);
    });

    it('should accept mixed case frame actions', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(transform(transform(ADD_CHANGE_SET_1).set('0.frames.0.action', 'Set')).set('0.frames.1.action', 'Delete')).set('0.frames.2.action', 'Post'));

      const frames = await getDataFrames('2020 VAT Rates');
      deq(frames.map((frame) => frame.action), ['SET', 'DELETE', 'SET']);
    });

    it('should accept change set actions in any case', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(transform(ADD_CHANGE_SET_1).del('0.frames')).set('0.changes', [{ entity: 'VAT Rate@1', action: 'delete', data: [{ type: 'standard' }] }]));

      const frames = await getDataFrames('2020 VAT Rates');
      deq(frames.map((frame) => frame.action), ['DELETE']);
    });

    it('should require frame action to be a string', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).set('0.frames.0.action', 1)), (err) => {
        eq(err.message, "001.should-require-frame-action-to-be-a-string.yaml: /0/frames/0/action must be of type 'string'");
        return true;
      });
    });

    it('should require frame action to be valid', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).set('0.frames.0.action', 'GET')), (err) => {
        eq(err.message, "001.should-require-frame-action-to-be-valid.yaml: /0/frames/0/action must be equal to one of the allowed values 'SET', 'POST' or 'DELETE'");
        return true;
      });
    });

    it('should require frame action to be valid in any case', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).set('0.frames.0.action', 'get')), (err) => {
        eq(err.message, "001.should-require-frame-action-to-be-valid-in-any-case.yaml: /0/frames/0/action must be equal to one of the allowed values 'SET', 'POST' or 'DELETE'");
        return true;
      });
    });

    it('should require frame data to specify at least one item', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).del('0.frames.0.data')), (err) => {
        eq(err.message, "001.should-require-frame-data-to-specify-at-least-one-item.yaml: /0/frames/0 must have required property 'source' or 'data'");
        return true;
      });

      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).set('0.frames.0.data', 1)), (err) => {
        eq(err.message, "001.should-require-frame-data-to-specify-at-least-one-item.yaml: /0/frames/0/data must be of type 'array'");
        return true;
      });

      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).set('0.frames.0.data', [])), (err) => {
        eq(err.message, '001.should-require-frame-data-to-specify-at-least-one-item.yaml: /0/frames/0/data must NOT have fewer than 1 items');
        return true;
      });
    });

    it('should escape data field names', async (t) => {
      const injection = "pwned', 1);RAISE EXCEPTION $💀$You have been pwned!$💀$;";
      await filby.applyYaml(
        t.name,
        transform(ADD_ENTITY).insert('0.fields', { name: injection, type: 'TEXT' }, 2),
        transform(ADD_CHANGE_SET_1).merge('0.frames.0.data.0', { [injection]: 'pwned' }),
      );

      const frames = await getDataFrames('2020 VAT Rates');
      eq(frames.length, 3);
      deq(frames[0], {
        description: '2020 VAT Rates',
        effective: new Date('2020-04-05T00:00:00.000Z'),
        entity: 'VAT Rate',
        version: 1,
        action: 'SET',
        type: 'standard',
        rate: 0.10,
        "pwned',_1);raise_exception_$💀$you_have_been_pwned!$💀$;": 'pwned',
      });
    });

    it('should escape data field values', async (t) => {
      const injection = "pwned', 1);RAISE EXCEPTION $💀$You have been pwned!$💀$;";
      await filby.applyYaml(
        t.name,
        transform(ADD_ENTITY).insert('0.fields', { name: 'pwned', type: 'TEXT' }, 2),
        transform(ADD_CHANGE_SET_1).merge('0.frames.0.data.0', { pwned: injection }),
      );

      const frames = await getDataFrames('2020 VAT Rates');
      eq(frames.length, 3);
      deq(frames[0], {
        description: '2020 VAT Rates',
        effective: new Date('2020-04-05T00:00:00.000Z'),
        entity: 'VAT Rate',
        version: 1,
        action: 'SET',
        type: 'standard',
        rate: 0.10,
        pwned: injection,
      });
    });

    it('should reject more than one frame for the same key', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_CHANGE_SET_1).set('0.frames.1.data.0.type', 'standard')), (err) => {
        eq(err.message, "Entity 'VAT Rate v1' has more than one frame with key (type=standard) in change set '2020 VAT Rates'");
        return true;
      });
    });

    it('should reject a delete for a key already set in the same change set', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(transform(ADD_CHANGE_SET_1).set('0.frames.1.data.0.type', 'standard')).set('0.frames.1.action', 'DELETE')), (err) => {
        eq(err.message, "Entity 'VAT Rate v1' has more than one frame with key (type=standard) in change set '2020 VAT Rates'");
        return true;
      });
    });

    it('should reject more than one frame for the same key in the same frame group', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_CHANGE_SET_1).set('0.frames.0.data', [{ type: 'standard', rate: 0.10 }, { type: 'zero', rate: 0 }, { type: 'standard', rate: 0.15 }])), (err) => {
        eq(err.message, "Entity 'VAT Rate v1' has more than one frame with key (type=standard) in change set '2020 VAT Rates'");
        return true;
      });
    });

    it('should reject data fields that do not exist', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_CHANGE_SET_1).merge('0.frames.0.data.0', { wombat: 1 })), (err) => {
        eq(err.message, "Change set '2020 VAT Rates' references a non existent field 'wombat' of entity 'VAT Rate v1'");
        return true;
      });
    });

    it('should store fields omitted from some data items as NULL', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_CHANGE_SET_1).set('0.frames.0.data', [{ type: 'standard', rate: 0.10 }, { type: 'super' }]));

      const frames = await getDataFrames('2020 VAT Rates');
      eq(frames.length, 4);
      deq(frames.map((frame) => [frame.type, frame.rate]), [['standard', 0.10], ['super', null], ['reduced', 0.05], ['zero', 0]]);
    });

    it('should reject frames without a key', async (t) => {
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_CHANGE_SET_1).del('0.frames.0.data.0.type')), (err) => {
        eq(err.code, NOT_NULL_VIOLATION);
        eq(err.message, '001.should-reject-frames-without-a-key.yaml: /1/frames/0/data/0 - null value in column "type" of relation "vat_rate_v1" violates not-null constraint');
        return true;
      });
    });

    it('should report the file and row of a value that cannot be cast to the column type', async (t) => {
      const changeSet = transform(ADD_CHANGE_SET_1).set('0.frames.1.data', [{ type: 'reduced', rate: 0.05 }, { type: 'super', rate: 0.2 }, { type: 'wombat', rate: 'abc' }]);

      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, changeSet), (err) => {
        eq(err.code, INVALID_TEXT_REPRESENTATION);
        eq(err.message, '001.should-report-the-file-and-row-of-a-value-that-cannot-be-cast-to-the-column-type.yaml: /1/frames/1/data/2 - invalid input syntax for type numeric: "abc"');
        return true;
      });

      const changeSets = await getChangeSets('2020 VAT Rates');
      eq(changeSets.length, 0);
    });

    it('should report the row location as changes when the change set uses changes', async (t) => {
      const { 0: { frames, ...changeSet } } = YAML.parse(ADD_CHANGE_SET_1);
      frames[2].data[0].rate = 'abc';

      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, YAML.stringify([{ ...changeSet, changes: frames }])), (err) => {
        eq(err.message, '001.should-report-the-row-location-as-changes-when-the-change-set-uses-changes.yaml: /1/changes/2/data/0 - invalid input syntax for type numeric: "abc"');
        return true;
      });
    });

    it('should report the file and row of an unknown enum value', async (t) => {
      const entity = transform(ADD_ENTITY).set('0.fields', [
        { name: 'type', type: 'vat_tax_rate' },
        { name: 'rate', type: 'NUMERIC' },
      ]);
      const changeSet = transform(ADD_CHANGE_SET_1).set('0.frames.1.data.0.type', 'wombat');

      await rejects(() => filby.applyYaml(t.name, ADD_ENUM, entity, changeSet), (err) => {
        eq(err.code, INVALID_TEXT_REPRESENTATION);
        eq(err.message, '001.should-report-the-file-and-row-of-an-unknown-enum-value.yaml: /2/frames/1/data/0 - invalid input value for enum vat_tax_rate: "wombat"');
        return true;
      });
    });

    it('should report the file and row of a check violation', async (t) => {
      const entity = transform(ADD_ENTITY).merge('0.checks', { max_rate: '(rate <= 1)' });
      const changeSet = transform(ADD_CHANGE_SET_1).set('0.frames.2.data.0.rate', 1.1);

      await rejects(() => filby.applyYaml(t.name, entity, changeSet), (err) => {
        eq(err.code, CHECK_VIOLATION);
        eq(err.message, '001.should-report-the-file-and-row-of-a-check-violation.yaml: /1/frames/2/data/0 - new row for relation "vat_rate_v1" violates check constraint "chk_max_rate"');
        return true;
      });
    });

    it('should report the file and row of a malformed timestamp', async (t) => {
      const entity = transform(ADD_ENTITY).insert('0.fields', { name: 'expires', type: 'TIMESTAMP WITH TIME ZONE' }, 2);
      const changeSet = transform(ADD_CHANGE_SET_1).merge('0.frames.0.data.0', { expires: 'wombat' });

      await rejects(() => filby.applyYaml(t.name, entity, changeSet), (err) => {
        eq(err.code, INVALID_DATETIME_FORMAT);
        eq(err.message, '001.should-report-the-file-and-row-of-a-malformed-timestamp.yaml: /1/frames/0/data/0 - invalid input syntax for type timestamp with time zone: "wombat"');
        return true;
      });
    });

    it('should cascade change set deletes through entity tables', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_CHANGE_SET_1);
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      await filby.withTransaction((tx) => tx.query('DELETE FROM fby_change_set WHERE id = $1', [changeSetId]));

      const { rows: frames } = await filby.withTransaction((tx) => tx.query('SELECT * FROM fby_data_frame'));
      eq(frames.length, 0);
      const { rows } = await filby.withTransaction((tx) => tx.query('SELECT * FROM vat_rate_v1'));
      eq(rows.length, 0);
    });

    it('should reject deleting a superseded change set without its re-issue', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, vatRate('2025', 'standard', 0.2), vatRate('2027', 'standard', 0.25), vatRate('2026', 'reduced', 0.05));
      const [original, reissued] = await getChangeSets('2027 VAT Rates');

      await rejects(() => filby.withTransaction((tx) => tx.query('DELETE FROM fby_change_set WHERE id = $1', [original.id])), (err) => {
        eq(err.code, FOREIGN_KEY_VIOLATION);
        return true;
      });

      await rejects(() => filby.withTransaction((tx) => tx.query('DELETE FROM fby_change_set WHERE id = $1', [reissued.id])), (err) => {
        eq(err.code, FOREIGN_KEY_VIOLATION);
        return true;
      });
    });

    it('should delete a superseded change set and its re-issue together', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, vatRate('2025', 'standard', 0.2), vatRate('2027', 'standard', 0.25), vatRate('2026', 'reduced', 0.05));
      const [original, reissued] = await getChangeSets('2027 VAT Rates');

      await filby.withTransaction((tx) => tx.query('DELETE FROM fby_change_set WHERE id IN ($1, $2)', [original.id, reissued.id]));

      const { rows: changeSets } = await filby.withTransaction((tx) => tx.query('SELECT description FROM fby_change_set ORDER BY id'));
      deq(changeSets, [{ description: '2025 VAT Rates' }, { description: '2026 VAT Rates' }]);
      eq((await getDataFrames('2027 VAT Rates')).length, 0);
      const { rows } = await filby.withTransaction((tx) => tx.query('SELECT rate FROM vat_rate_v1 ORDER BY rate'));
      deq(rows, [{ rate: 0.05 }, { rate: 0.2 }]);
    });

    it('should record each entity in a change set once', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, transform(ADD_ENTITY).set('0.version', 2), transform(ADD_CHANGE_SET_1).set('0.frames.2.version', 2));

      deq(await getChangeSetEntities(), [
        { description: '2020 VAT Rates', name: 'VAT Rate', version: 1 },
        { description: '2020 VAT Rates', name: 'VAT Rate', version: 2 },
      ]);
    });

    it('should record the entities of re-issued change sets', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, vatRate('2025', 'standard', 0.2), vatRate('2027', 'standard', 0.25), vatRate('2026', 'reduced', 0.05));

      const [, reissued] = await getChangeSets('2027 VAT Rates');
      const { rows } = await filby.withTransaction((tx) => tx.query('SELECT entity_id FROM fby_change_set_entity WHERE change_set_id = $1', [reissued.id]));
      eq(rows.length, 1);
    });

    it('should re-issue change sets with a later effective date', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, vatRate('2025', 'standard', 0.2), vatRate('2027', 'standard', 0.25), vatRate('2026', 'reduced', 0.05));

      const [original, reissued] = await getChangeSets('2027 VAT Rates');
      eq(original.superseded_by, reissued.id);
      eq(reissued.reissued_from, original.id);

      const projection = await filby.getProjection('VAT Rates', 1);
      const changeLog = await filby.getChangeLog(projection);
      deq(changeLog.map(({ id, description, reissuedFrom }) => ({ id, description, reissuedFrom })), [
        { id: await getChangeSetId('2025 VAT Rates'), description: '2025 VAT Rates', reissuedFrom: undefined },
        { id: await getChangeSetId('2026 VAT Rates'), description: '2026 VAT Rates', reissuedFrom: undefined },
        { id: reissued.id, description: '2027 VAT Rates', reissuedFrom: original.id },
      ]);

      const changeSet = await filby.getChangeSet(original.id);
      eq(changeSet.description, '2027 VAT Rates');
      eq(changeSet.effective.toISOString(), '2027-04-05T00:00:00.000Z');
      deq(await filby.getAggregates(original.id, 'VAT Rate', 1), [{ type: 'standard', rate: 0.25 }]);
      deq(await filby.getAggregates(reissued.id, 'VAT Rate', 1), [{ type: 'reduced', rate: 0.05 }, { type: 'standard', rate: 0.25 }]);
    });

    it('should re-issue change sets when backfilling', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, vatRate('2020', 'standard', 0.2), vatRate('2022', 'standard', 0.25), vatRate('2021', 'reduced', 0.05));

      const [original, reissued] = await getChangeSets('2022 VAT Rates');
      const projection = await filby.getProjection('VAT Rates', 1);
      const changeSet = await filby.getCurrentChangeSet(projection);
      eq(changeSet.id, reissued.id);
      eq(changeSet.reissuedFrom, original.id);
      deq(await filby.getAggregates(reissued.id, 'VAT Rate', 1), [{ type: 'reduced', rate: 0.05 }, { type: 'standard', rate: 0.25 }]);
      deq(await filby.getAggregates(original.id, 'VAT Rate', 1), [{ type: 'standard', rate: 0.25 }]);
    });

    it('should not re-issue change sets with the same effective date', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, vatRate('2020', 'standard', 0.2), vatRate('2021', 'standard', 0.25), transform(vatRate('2021', 'standard', 0.3)).set('0.description', '2021 VAT Rates Correction'));

      const { rows } = await filby.withTransaction((tx) => tx.query('SELECT description, superseded_by, reissued_from FROM fby_change_set ORDER BY id'));
      deq(rows, [
        { description: '2020 VAT Rates', superseded_by: null, reissued_from: null },
        { description: '2021 VAT Rates', superseded_by: null, reissued_from: null },
        { description: '2021 VAT Rates Correction', superseded_by: null, reissued_from: null },
      ]);

      const projection = await filby.getProjection('VAT Rates', 1);
      const changeSet = await filby.getCurrentChangeSet(projection);
      eq(changeSet.description, '2021 VAT Rates Correction');
      deq(await filby.getAggregates(changeSet.id, 'VAT Rate', 1), [{ type: 'standard', rate: 0.3 }]);
      deq(await filby.getAggregates(await getChangeSetId('2021 VAT Rates'), 'VAT Rate', 1), [{ type: 'standard', rate: 0.25 }]);
    });

    it('should schedule notifications for re-issued change sets', async (t) => {
      await filby.applyYaml(
        t.name,
        ADD_ENTITY,
        transform(ADD_ENTITY).set('0.version', 2),
        ADD_PROJECTION,
        vatRate('2020', 'standard', 0.2),
        vatRate('2022', 'standard', 0.25),
        ADD_HOOK_CHANGE_SET_PROJECTION,
        transform(vatRate('2021', 'reduced', 0.05)).set('0.frames.0.version', 2),
      );

      const { rows: notifications } = await filby.withTransaction((tx) => tx.query(`
        SELECT h.name AS hook_name, n.projection_name, n.projection_version
        FROM fby_notification n
        INNER JOIN fby_hook h ON h.id = n.hook_id`));
      deq(notifications, [{ hook_name: 'sns/add-change-set/vat-rates-v1', projection_name: 'VAT Rates', projection_version: 1 }]);
    });

    it('should forbid additional properties in frames', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).merge('0.frames.0', { wombat: 1 })), (err) => {
        eq(err.message, "001.should-forbid-additional-properties-in-frames.yaml: /0/frames/0 must NOT have additional property 'wombat'");
        return true;
      });
    });

    it('should forbid additional properties', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).merge('0', { wombat: 1 })), (err) => {
        eq(err.message, "001.should-forbid-additional-properties.yaml: /0 must NOT have additional property 'wombat'");
        return true;
      });
    });

    it('should store a field with no value as NULL', async (t) => {
      await filby.applyYaml(t.name, transform(ADD_ENTITY).insert('0.fields', { name: 'label', type: 'TEXT' }, 2), vatRateWith('label:'));

      const frames = await getDataFrames('2020 VAT Rates');
      eq(frames.length, 1);
      eq(frames[0].label, null);
    });

    it('should store a tilde as NULL', async (t) => {
      await filby.applyYaml(t.name, transform(ADD_ENTITY).insert('0.fields', { name: 'label', type: 'TEXT' }, 2), vatRateWith('label: ~'));

      const frames = await getDataFrames('2020 VAT Rates');
      eq(frames.length, 1);
      eq(frames[0].label, null);
    });

    it('should store a field with no value in a numeric column as NULL', async (t) => {
      await filby.applyYaml(t.name, transform(ADD_ENTITY).insert('0.fields', { name: 'threshold', type: 'INTEGER' }, 2), vatRateWith('threshold:'));

      const frames = await getDataFrames('2020 VAT Rates');
      eq(frames.length, 1);
      eq(frames[0].threshold, null);
    });

    it('should store a nested map as JSON', async (t) => {
      await filby.applyYaml(t.name, transform(ADD_ENTITY).insert('0.fields', { name: 'metadata', type: 'JSONB' }, 2), vatRateWith('metadata:\n            pool: true\n            region: south west'));

      const frames = await getDataFrames('2020 VAT Rates');
      eq(frames.length, 1);
      deq(frames[0].metadata, { pool: true, region: 'south west' });
    });

    it('should store a nested list as JSON', async (t) => {
      await filby.applyYaml(t.name, transform(ADD_ENTITY).insert('0.fields', { name: 'tags', type: 'JSONB' }, 2), vatRateWith('tags:\n            - food\n            - drink'));

      const frames = await getDataFrames('2020 VAT Rates');
      eq(frames.length, 1);
      deq(frames[0].tags, ['food', 'drink']);
    });

    it('should store a quoted string that looks like a map as text', async (t) => {
      await filby.applyYaml(t.name, transform(ADD_ENTITY).insert('0.fields', { name: 'label', type: 'TEXT' }, 2), vatRateWith('label: "{ pool: true }"'));

      const frames = await getDataFrames('2020 VAT Rates');
      eq(frames.length, 1);
      eq(frames[0].label, '{ pool: true }');
    });
  });

  describe('Add Hook', () => {

    describe('Projection Specific', () => {

      it('should add hooks', async (t) => {
        await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, ADD_HOOK_CHANGE_SET_PROJECTION);

        const { rows: hooks } = await filby.withTransaction((tx) => tx.query(`
          SELECT h.name, h.event, p.name AS projection, version
          FROM fby_hook h
          LEFT JOIN fby_projection p ON h.projection_id = p.id
        `));

        eq(hooks.length, 1);
        deq(hooks[0], { name: 'sns/add-change-set/vat-rates-v1', event: 'ADD_CHANGE_SET', projection: 'VAT Rates', version: 1 });
      });

      it('should reject duplicate hook', async (t) => {
        await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, ADD_HOOK_CHANGE_SET_PROJECTION, ADD_HOOK_CHANGE_SET_PROJECTION), (err) => {
          eq(err.message, "Hook 'sns/add-change-set/vat-rates-v1' already exists");
          return true;
        });
      });

      it('should require a name', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(ADD_HOOK_CHANGE_SET_PROJECTION).del('0.name')), (err) => {
          eq(err.message, "001.should-require-a-name.yaml: /0 must have required property 'name'");
          return true;
        });
      });

      it('should require name to be a string', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(ADD_HOOK_CHANGE_SET_PROJECTION).set('0.name', 1)), (err) => {
          eq(err.message, "001.should-require-name-to-be-a-string.yaml: /0/name must be of type 'string'");
          return true;
        });
      });

      it('should escape name', async (t) => {
        const injection = "pwned', null, 'ADD_CHANGE_SET', 1);RAISE EXCEPTION $💀$You have been pwned!$💀$;--";
        await filby.applyYaml(
          t.name,
          ADD_ENTITY,
          ADD_PROJECTION,
          transform(ADD_HOOK_CHANGE_SET_PROJECTION).set('0.name', injection),
        );

        const { rows: hooks } = await filby.withTransaction((tx) => tx.query(`
          SELECT h.name, h.event, p.name AS projection, version
          FROM fby_hook h
          LEFT JOIN fby_projection p ON h.projection_id = p.id
        `));

        eq(hooks.length, 1);
        deq(hooks[0], { name: injection, event: 'ADD_CHANGE_SET', projection: 'VAT Rates', version: 1 });
      });

      it('should require an event', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(ADD_HOOK_CHANGE_SET_PROJECTION).del('0.event')), (err) => {
          eq(err.message, "001.should-require-an-event.yaml: /0 must have required property 'event'");
          return true;
        });
      });

      it('should require event to be a string', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(ADD_HOOK_CHANGE_SET_PROJECTION).set('0.event', 1)), (err) => {
          eq(err.message, "001.should-require-event-to-be-a-string.yaml: /0/event must be of type 'string'");
          return true;
        });
      });

      it('should require event to be valid', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(ADD_HOOK_CHANGE_SET_PROJECTION).set('0.event', 'wombat')), (err) => {
          eq(err.message, "001.should-require-event-to-be-valid.yaml: /0/event must be equal to one of the allowed values 'ADD_CHANGE_SET' or 'COMMENCE_CHANGE_SET'");
          return true;
        });
      });

      it('should require event to be a change set event', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(ADD_HOOK_CHANGE_SET_PROJECTION).set('0.event', 'ADD_PROJECTION')), (err) => {
          eq(err.message, "001.should-require-event-to-be-a-change-set-event.yaml: /0/event must be equal to one of the allowed values 'ADD_CHANGE_SET' or 'COMMENCE_CHANGE_SET'");
          return true;
        });
      });

      it('should accept the COMMENCE_CHANGE_SET event', async (t) => {
        doesNotThrow(() => validateMigration(t.name, YAML.parse(transform(ADD_HOOK_CHANGE_SET_PROJECTION).set('0.event', 'COMMENCE_CHANGE_SET'))));
      });

      it('should add a projection specific COMMENCE_CHANGE_SET hook', async (t) => {
        await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, transform(ADD_HOOK_CHANGE_SET_PROJECTION).set('0.event', 'COMMENCE_CHANGE_SET'));

        const { rows: hooks } = await filby.withTransaction((tx) => tx.query(`
          SELECT h.name, h.event, p.name AS projection, version
          FROM fby_hook h
          LEFT JOIN fby_projection p ON h.projection_id = p.id
        `));

        deq(hooks, [{ name: 'sns/add-change-set/vat-rates-v1', event: 'COMMENCE_CHANGE_SET', projection: 'VAT Rates', version: 1 }]);
      });

      it('should require a projection', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(ADD_HOOK_CHANGE_SET_PROJECTION).del('0.projection')), (err) => {
          eq(err.message, "001.should-require-a-projection.yaml: /0 must have required property 'projection'");
          return true;
        });
      });

      it('should require projection to be a string', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(ADD_HOOK_CHANGE_SET_PROJECTION).set('0.projection', 1)), (err) => {
          eq(err.message, "001.should-require-projection-to-be-a-string.yaml: /0/projection must be of type 'string'");
          return true;
        });
      });

      it('should require projection to exist', async (t) => {
        await rejects(() => filby.applyYaml(
          t.name,
          ADD_ENTITY,
          ADD_PROJECTION,
          transform(ADD_HOOK_CHANGE_SET_PROJECTION).set('0.projection', 'wombat'),
        ), (err) => {
          eq(err.message, "Hook 'sns/add-change-set/vat-rates-v1' references a non existent projection 'wombat v1'; existing projections are 'VAT Rates v1'");
          return true;
        });
      });

      it('should suggest a projection that differs only by case', async (t) => {
        await rejects(() => filby.applyYaml(
          t.name,
          ADD_ENTITY,
          ADD_PROJECTION,
          transform(ADD_HOOK_CHANGE_SET_PROJECTION).set('0.projection', 'vat rates'),
        ), (err) => {
          eq(err.message, "Hook 'sns/add-change-set/vat-rates-v1' references a non existent projection 'vat rates v1'; did you mean 'VAT Rates v1'?");
          return true;
        });
      });

      it('should list every existing projection when the projection does not exist', async (t) => {
        await rejects(() => filby.applyYaml(
          t.name,
          ADD_ENTITY,
          ADD_PROJECTION,
          transform(ADD_PROJECTION).set('0.version', 2),
          transform(ADD_HOOK_CHANGE_SET_PROJECTION).set('0.projection', 'wombat'),
        ), (err) => {
          eq(err.message, "Hook 'sns/add-change-set/vat-rates-v1' references a non existent projection 'wombat v1'; existing projections are 'VAT Rates v1', 'VAT Rates v2'");
          return true;
        });
      });

      it('should report that no projections exist when the projection does not exist', async (t) => {
        await rejects(() => filby.applyYaml(t.name, ADD_HOOK_CHANGE_SET_PROJECTION), (err) => {
          eq(err.message, "Hook 'sns/add-change-set/vat-rates-v1' references a non existent projection 'VAT Rates v1'; no projections exist");
          return true;
        });
      });

      it('should escape projection', async (t) => {
        const injection = "pwned', 1);RAISE EXCEPTION $💀$You have been pwned!$💀$;";
        await filby.applyYaml(
          t.name,
          ADD_ENTITY,
          transform(ADD_PROJECTION).set('0.name', injection),
          transform(ADD_HOOK_CHANGE_SET_PROJECTION).set('0.projection', injection),
        );

        const { rows: hooks } = await filby.withTransaction((tx) => tx.query(`
          SELECT h.name, h.event, p.name AS projection, version
          FROM fby_hook h
          LEFT JOIN fby_projection p ON h.projection_id = p.id
        `));

        eq(hooks.length, 1);
        deq(hooks[0], { name: 'sns/add-change-set/vat-rates-v1', event: 'ADD_CHANGE_SET', projection: injection, version: 1 });
      });

      it('should require a version', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(ADD_HOOK_CHANGE_SET_PROJECTION).del('0.version')), (err) => {
          eq(err.message, "001.should-require-a-version.yaml: /0 must have required property 'version'");
          return true;
        });
      });

      it('should require version to be an integer', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(ADD_HOOK_CHANGE_SET_PROJECTION).set('0.version', 'wombat')), (err) => {
          eq(err.message, "001.should-require-version-to-be-an-integer.yaml: /0/version must be of type 'integer'");
          return true;
        });
      });

      it('should accept projection@version references', async (t) => {
        await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, transform(transform(ADD_HOOK_CHANGE_SET_PROJECTION).del('0.version')).set('0.projection', 'VAT Rates@1'));

        const { rows: hooks } = await filby.withTransaction((tx) => tx.query(`
          SELECT h.name, h.event, p.name AS projection, version
          FROM fby_hook h
          LEFT JOIN fby_projection p ON h.projection_id = p.id
        `));

        deq(hooks, [{ name: 'sns/add-change-set/vat-rates-v1', event: 'ADD_CHANGE_SET', projection: 'VAT Rates', version: 1 }]);
      });

      it('should require projection@version references to exist', async (t) => {
        await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, transform(transform(ADD_HOOK_CHANGE_SET_PROJECTION).del('0.version')).set('0.projection', 'VAT Rates@2')), (err) => {
          eq(err.message, "Hook 'sns/add-change-set/vat-rates-v1' references a non existent projection 'VAT Rates v2'; existing projections are 'VAT Rates v1'");
          return true;
        });
      });

      it('should require projection@version references to use a change set event', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(transform(transform(ADD_HOOK_CHANGE_SET_PROJECTION).del('0.version')).set('0.projection', 'VAT Rates@1')).set('0.event', 'ADD_PROJECTION')), (err) => {
          eq(err.message, "001.should-require-projection@version-references-to-use-a-change-set-event.yaml: /0/event must be equal to one of the allowed values 'ADD_CHANGE_SET' or 'COMMENCE_CHANGE_SET'");
          return true;
        });
      });

      it('should reject projection references that also specify a version', async (t) => {
        await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, transform(ADD_HOOK_CHANGE_SET_PROJECTION).set('0.projection', 'VAT Rates@1')), (err) => {
          eq(err.message, "Reference 'VAT Rates@1' must not also specify a version");
          return true;
        });
      });

      it('should allow a description', async (t) => {
        await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, transform(ADD_HOOK_CHANGE_SET_PROJECTION).merge('0.description', 'wombat'));
      });

      it('should require description to be a string', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(ADD_HOOK_CHANGE_SET_PROJECTION).merge('0.description', 1)), (err) => {
          eq(err.message, "001.should-require-description-to-be-a-string.yaml: /0/description must be of type 'string'");
          return true;
        });
      });

      it('should escape description', async (t) => {
        const injection = "pwned', 'ADD_CHANGE_SET', 1);RAISE EXCEPTION $💀$You have been pwned!$💀$;--";
        await filby.applyYaml(
          t.name,
          ADD_ENTITY,
          ADD_PROJECTION,
          transform(ADD_HOOK_CHANGE_SET_PROJECTION).set('0.description', injection),
        );

        const { rows: projections } = await filby.withTransaction((tx) => tx.query('SELECT description FROM fby_hook'));
        eq(projections.length, 1);
        deq(projections[0], { description: injection });
      });

      it('should forbid additional properties', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(ADD_HOOK_CHANGE_SET_PROJECTION).merge('0', { wombat: 1 })), (err) => {
          eq(err.message, "001.should-forbid-additional-properties.yaml: /0 must NOT have additional property 'wombat'");
          return true;
        });
      });
    });

    describe('General', () => {

      it('should add hooks', async (t) => {
        await filby.applyYaml(t.name, ADD_HOOK_CHANGE_SET_GENERAL);

        const { rows: hooks } = await filby.withTransaction((tx) => tx.query(`
          SELECT h.name, h.event, p.name AS projection, version
          FROM fby_hook h
          LEFT JOIN fby_projection p ON h.projection_id = p.id
        `));

        eq(hooks.length, 1);
        deq(hooks[0], { name: 'sns/add-change-set/*', event: 'ADD_CHANGE_SET', projection: null, version: null });
      });

      it('should reject duplicate hook', async (t) => {
        await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, ADD_HOOK_CHANGE_SET_GENERAL, ADD_HOOK_CHANGE_SET_GENERAL), (err) => {
          eq(err.message, "Hook 'sns/add-change-set/*' already exists");
          return true;
        });
      });

      it('should require a name', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(ADD_HOOK_CHANGE_SET_PROJECTION).del('0.name')), (err) => {
          eq(err.message, "001.should-require-a-name.yaml: /0 must have required property 'name'");
          return true;
        });
      });

      it('should require name to be a string', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(ADD_HOOK_CHANGE_SET_PROJECTION).set('0.name', 1)), (err) => {
          eq(err.message, "001.should-require-name-to-be-a-string.yaml: /0/name must be of type 'string'");
          return true;
        });
      });

      it('should escape name', async (t) => {
        await filby.applyYaml(
          t.name,
          ADD_ENTITY,
          ADD_PROJECTION,
          transform(ADD_HOOK_CHANGE_SET_GENERAL).set('0.name', "pwned', 1);RAISE EXCEPTION $💀$You have been pwned!$💀$;"),
        );

        const { rows: hooks } = await filby.withTransaction((tx) => tx.query(`
          SELECT h.name, h.event, p.name AS projection, version
          FROM fby_hook h
          LEFT JOIN fby_projection p ON h.projection_id = p.id
        `));

        eq(hooks.length, 1);
        deq(hooks[0], { name: "pwned', 1);RAISE EXCEPTION $💀$You have been pwned!$💀$;", event: 'ADD_CHANGE_SET', projection: null, version: null });
      });

      it('should require an event', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(ADD_HOOK_CHANGE_SET_GENERAL).del('0.event')), (err) => {
          eq(err.message, "001.should-require-an-event.yaml: /0 must have required property 'event'");
          return true;
        });
      });

      it('should require event to be a string', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(ADD_HOOK_CHANGE_SET_GENERAL).set('0.event', 1)), (err) => {
          eq(err.message, "001.should-require-event-to-be-a-string.yaml: /0/event must be of type 'string'");
          return true;
        });
      });

      it('should require event to be valid', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(ADD_HOOK_CHANGE_SET_GENERAL).set('0.event', 'wombat')), (err) => {
          eq(err.message, "001.should-require-event-to-be-valid.yaml: /0/event must be equal to one of the allowed values 'ADD_PROJECTION', 'DROP_PROJECTION', 'ADD_CHANGE_SET' or 'COMMENCE_CHANGE_SET'");
          return true;
        });
      });

      it('should allow a description', async (t) => {
        await filby.applyYaml(t.name, transform(ADD_HOOK_CHANGE_SET_GENERAL).merge('0.description', 'wombat'));
      });

      it('should require description to be a string', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(ADD_HOOK_CHANGE_SET_GENERAL).merge('0.description', 1)), (err) => {
          eq(err.message, "001.should-require-description-to-be-a-string.yaml: /0/description must be of type 'string'");
          return true;
        });
      });

      it('should escape description', async (t) => {
        const injection = "pwned', 'ADD_CHANGE_SET', null);RAISE EXCEPTION $💀$You have been pwned!$💀$;--";
        await filby.applyYaml(
          t.name,
          ADD_ENTITY,
          ADD_PROJECTION,
          transform(ADD_HOOK_CHANGE_SET_GENERAL).set('0.description', injection),
        );

        const { rows: projections } = await filby.withTransaction((tx) => tx.query('SELECT description FROM fby_hook'));
        eq(projections.length, 1);
        deq(projections[0], { description: injection });
      });

      it('should forbid additional properties', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(ADD_HOOK_CHANGE_SET_GENERAL).merge('0', { wombat: 1 })), (err) => {
          eq(err.message, "001.should-forbid-additional-properties.yaml: /0 must NOT have additional property 'wombat'");
          return true;
        });
      });
    });
  });

  describe('Drop Hook', () => {

    describe('Projection Specific', () => {

      it('should drop hooks', async (t) => {
        await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, ADD_HOOK_CHANGE_SET_PROJECTION, DROP_HOOK_ADD_CHANGE_SET_PROJECTION);
        const { rows: hooks } = await filby.withTransaction((tx) => tx.query('SELECT * FROM fby_hook'));
        eq(hooks.length, 0);
      });

      it('should ignore other hooks', async (t) => {
        const ADD_ANOTHER_PROJECTION_HOOK = `
- operation: ADD_HOOK
  name: httpbin/add-change-set/vat-rates-v1
  event: ADD_CHANGE_SET
  projection: VAT Rates
  version: 1
`;
        await filby.applyYaml(
          t.name,
          ADD_ENTITY,
          ADD_PROJECTION,
          ADD_HOOK_CHANGE_SET_PROJECTION,
          ADD_ANOTHER_PROJECTION_HOOK,
          DROP_HOOK_ADD_CHANGE_SET_PROJECTION,
        );

        const { rows: hooks } = await filby.withTransaction((tx) => tx.query('SELECT * FROM fby_hook'));
        eq(hooks.length, 1);
      });

      it('should require a name', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(DROP_HOOK_ADD_CHANGE_SET_PROJECTION).del('0.name')), (err) => {
          eq(err.message, "001.should-require-a-name.yaml: /0 must have required property 'name'");
          return true;
        });
      });

      it('should require name to be a string', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(DROP_HOOK_ADD_CHANGE_SET_PROJECTION).set('0.name', 1)), (err) => {
          eq(err.message, "001.should-require-name-to-be-a-string.yaml: /0/name must be of type 'string'");
          return true;
        });
      });

      it('should escape name', async (t) => {
        const injection = "pwned', 1);RAISE EXCEPTION $💀$You have been pwned!$💀$;";
        await filby.applyYaml(
          t.name,
          ADD_ENTITY,
          ADD_PROJECTION,
          transform(ADD_HOOK_CHANGE_SET_PROJECTION).set('0.name', injection),
          transform(DROP_HOOK_ADD_CHANGE_SET_PROJECTION).set('0.name', injection),
        );

        const { rows: hooks } = await filby.withTransaction((tx) => tx.query(`
          SELECT h.name, h.event, p.name AS projection, version
          FROM fby_hook h
          LEFT JOIN fby_projection p ON h.projection_id = p.id
        `));

        eq(hooks.length, 0);
      });

      it('should allow a description', async (t) => {
        await filby.applyYaml(
          t.name,
          ADD_ENTITY,
          ADD_PROJECTION,
          ADD_HOOK_CHANGE_SET_PROJECTION,
          transform(DROP_HOOK_ADD_CHANGE_SET_PROJECTION).merge('0.description', 'wombat'),
        );
      });

      it('should require description to be a string', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(DROP_HOOK_ADD_CHANGE_SET_PROJECTION).merge('0.description', 1)), (err) => {
          eq(err.message, "001.should-require-description-to-be-a-string.yaml: /0/description must be of type 'string'");
          return true;
        });
      });

      it('should forbid additional properties', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(DROP_HOOK_ADD_CHANGE_SET_PROJECTION).merge('0', { wombat: 1 })), (err) => {
          eq(err.message, "001.should-forbid-additional-properties.yaml: /0 must NOT have additional property 'wombat'");
          return true;
        });
      });

      it('should report missing hooks', async (t) => {
        await rejects(() => filby.applyYaml(t.name, DROP_HOOK_ADD_CHANGE_SET_PROJECTION), (err) => {
          eq(err.message, "Hook 'sns/add-change-set/vat-rates-v1' does not exist");
          return true;
        });
      });
    });

    describe('General', () => {

      it('should drop hooks', async (t) => {
        await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, ADD_HOOK_CHANGE_SET_GENERAL, DROP_HOOK_ADD_CHANGE_SET_GENERAL);
        const { rows: hooks } = await filby.withTransaction((tx) => tx.query('SELECT * FROM fby_hook'));
        eq(hooks.length, 0);
      });

      it('should ignore other hooks', async (t) => {
        const ADD_ANOTHER_GENERAL_HOOK = `
- operation: ADD_HOOK
  name: httpbin/add-change-set/vat-rates-v1
  event: ADD_CHANGE_SET
`;
        await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, ADD_HOOK_CHANGE_SET_GENERAL, ADD_ANOTHER_GENERAL_HOOK, DROP_HOOK_ADD_CHANGE_SET_GENERAL);

        const { rows: hooks } = await filby.withTransaction((tx) => tx.query('SELECT * FROM fby_hook'));
        eq(hooks.length, 1);
      });

      it('should require a name', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(DROP_HOOK_ADD_CHANGE_SET_GENERAL).del('0.name')), (err) => {
          eq(err.message, "001.should-require-a-name.yaml: /0 must have required property 'name'");
          return true;
        });
      });

      it('should require name to be a string', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(DROP_HOOK_ADD_CHANGE_SET_GENERAL).set('0.name', 1)), (err) => {
          eq(err.message, "001.should-require-name-to-be-a-string.yaml: /0/name must be of type 'string'");
          return true;
        });
      });

      it('should escape name', async (t) => {
        const injection = "pwned', 1);RAISE EXCEPTION $💀$You have been pwned!$💀$;";
        await filby.applyYaml(
          t.name,
          ADD_ENTITY,
          ADD_PROJECTION,
          transform(ADD_HOOK_CHANGE_SET_GENERAL).set('0.name', injection),
          transform(DROP_HOOK_ADD_CHANGE_SET_GENERAL).set('0.name', injection),
        );

        const { rows: hooks } = await filby.withTransaction((tx) => tx.query(`
          SELECT h.name, h.event, p.name AS projection, version
          FROM fby_hook h
          LEFT JOIN fby_projection p ON h.projection_id = p.id
        `));

        eq(hooks.length, 0);
      });

      it('should allow a description', async (t) => {
        await filby.applyYaml(t.name, ADD_HOOK_CHANGE_SET_GENERAL, transform(DROP_HOOK_ADD_CHANGE_SET_GENERAL).merge('0.description', 'wombat'));
      });

      it('should require description to be a string', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(DROP_HOOK_ADD_CHANGE_SET_GENERAL).merge('0.description', 1)), (err) => {
          eq(err.message, "001.should-require-description-to-be-a-string.yaml: /0/description must be of type 'string'");
          return true;
        });
      });

      it('should forbid additional properties', async (t) => {
        await rejects(() => filby.applyYaml(t.name, transform(DROP_HOOK_ADD_CHANGE_SET_GENERAL).merge('0', { wombat: 1 })), (err) => {
          eq(err.message, "001.should-forbid-additional-properties.yaml: /0 must NOT have additional property 'wombat'");
          return true;
        });
      });

      it('should report missing hooks', async (t) => {
        await rejects(() => filby.applyYaml(t.name, DROP_HOOK_ADD_CHANGE_SET_GENERAL), (err) => {
          eq(err.message, "Hook 'sns/add-change-set/*' does not exist");
          return true;
        });
      });
    });
  });

  describe('Aggregates', () => {

    const ADD_CHANGE_SET_2 = loadYaml('ADD_CHANGE_SET_2');
    const ADD_CHANGE_SET_3 = loadYaml('ADD_CHANGE_SET_3');
    const ADD_CHANGE_SET_4 = loadYaml('ADD_CHANGE_SET_4');
    const ADD_CHANGE_SET_5 = loadYaml('ADD_CHANGE_SET_5');

    it('should aggregate data frames up to the specified change set', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, ADD_CHANGE_SET_1, ADD_CHANGE_SET_2, ADD_CHANGE_SET_3);

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

    it('should ignore lower change sets with a later effective date', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, ADD_CHANGE_SET_1, ADD_CHANGE_SET_2, ADD_CHANGE_SET_3, ADD_CHANGE_SET_4, ADD_CHANGE_SET_5);

      const changeSetId = await getChangeSetId('2022 VAT Rates Fix');

      await filby.withTransaction(async (tx) => {
        const { rows: aggregate1 } = await tx.query('SELECT * FROM get_vat_rate_v1_aggregate($1) ORDER BY rate DESC', [changeSetId]);
        eq(aggregate1.length, 3);
        deq(aggregate1[0], { type: 'standard', rate: 0.16 });
        deq(aggregate1[1], { type: 'reduced', rate: 0.11 });
        deq(aggregate1[2], { type: 'zero', rate: 0 });
      });
    });

    it('should generate stable sql aggregate functions', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY);

      const { rows } = await filby.withTransaction((tx) => tx.query(`
        SELECT l.lanname AS language, p.provolatile AS volatility
        FROM pg_proc p
        INNER JOIN pg_language l ON l.oid = p.prolang
        WHERE p.proname = 'get_vat_rate_v1_aggregate'`));
      deq(rows, [{ language: 'sql', volatility: 's' }]);
    });

    it('should inline aggregate functions so that filters are applied before materialisation', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, ADD_CHANGE_SET_1);

      const changeSetId = await getChangeSetId('2020 VAT Rates');
      const { rows } = await filby.withTransaction((tx) => tx.query(`EXPLAIN SELECT * FROM get_vat_rate_v1_aggregate(${changeSetId}) WHERE type = 'standard'`));
      const plan = rows.map((row) => row['QUERY PLAN']).join('\n');
      ok(!plan.includes('Function Scan'), plan);
    });

    it('should prefer the frame with the latest effective date over the most recently added frame', async (t) => {
      await filby.applyYaml(
        t.name,
        ADD_ENTITY,
        ADD_PROJECTION,
        vatRate('2020', 'standard', 0.175),
        vatRate('2022', 'standard', 0.20),
        vatRate('2021', 'standard', 0.18),
        vatRate('2023', 'reduced', 0.05),
      );

      await filby.withTransaction(async (tx) => {
        const { rows: aggregate2021 } = await tx.query('SELECT * FROM get_vat_rate_v1_aggregate($1)', [await getChangeSetId('2021 VAT Rates')]);
        deq(aggregate2021, [{ type: 'standard', rate: 0.18 }]);

        const { rows: aggregate2023 } = await tx.query('SELECT * FROM get_vat_rate_v1_aggregate($1) ORDER BY rate DESC', [await getChangeSetId('2023 VAT Rates')]);
        deq(aggregate2023, [{ type: 'standard', rate: 0.20 }, { type: 'reduced', rate: 0.05 }]);
      });
    });

    it('should exclude aggregates where the most recent frame was a delete', async (t) => {
      await filby.applyYaml(
        t.name,
        ADD_ENTITY,
        ADD_PROJECTION,
        ADD_CHANGE_SET_1,
        ADD_CHANGE_SET_2,
        transform(ADD_CHANGE_SET_3).set('0.frames.1.action', 'DELETE'),
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
        (yaml) => transform(yaml).set('2.frames.0.source', '../dsl/datafiles/vat-rate-v1-2020.csv'),
        (yaml) => transform(yaml).del('2.frames.0.action'),
        (yaml) => transform(yaml).del('2.frames.0.data'),
        (yaml) => transform(yaml).del('2.frames.1'),
        (yaml) => transform(yaml).del('2.frames.1'),
        (yaml) => transform(yaml).set('3.frames.0.source', '../dsl/datafiles/vat-rate-v1-2021.csv'),
        (yaml) => transform(yaml).del('3.frames.0.action'),
        (yaml) => transform(yaml).del('3.frames.0.data'),
        (yaml) => transform(yaml).del('3.frames.1'),
        (yaml) => transform(yaml).set('4.frames.0.source', '../dsl/datafiles/vat-rate-v1-2022.csv'),
        (yaml) => transform(yaml).del('4.frames.0.action'),
        (yaml) => transform(yaml).del('4.frames.0.data'),
        (yaml) => transform(yaml).del('4.frames.1'),
      ];

      const yaml = transforms.reduce((document, tx) => {
        return tx(document);
      }, [ADD_ENTITY, ADD_PROJECTION, ADD_CHANGE_SET_1, ADD_CHANGE_SET_2, ADD_CHANGE_SET_3].join('\n'));

      await filby.applyYaml(t.name, yaml);

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

    it('should store csv SET frames as SET', async (t) => {
      const yaml = transform(ADD_CHANGE_SET_1).set('0.frames', [{ entity: 'VAT Rate', version: 1, source: '../dsl/datafiles/vat-rate-v1-2020-set.csv' }]);
      await filby.applyYaml(t.name, ADD_ENTITY, yaml);

      const frames = await getDataFrames('2020 VAT Rates');
      deq(frames.map((frame) => frame.action), ['SET', 'SET', 'SET']);
    });

    it('should store csv POST frames as SET', async (t) => {
      const yaml = transform(ADD_CHANGE_SET_1).set('0.frames', [{ entity: 'VAT Rate', version: 1, source: '../dsl/datafiles/vat-rate-v1-2020.csv' }]);
      await filby.applyYaml(t.name, ADD_ENTITY, yaml);

      const frames = await getDataFrames('2020 VAT Rates');
      deq(frames.map((frame) => frame.action), ['SET', 'SET', 'SET']);
    });

    it('should apply the frame action to every csv row', async (t) => {
      const yaml = transform(ADD_CHANGE_SET_1).set('0.frames', [{ entity: 'VAT Rate', version: 1, action: 'DELETE', source: '../dsl/datafiles/vat-rate-v1-2020-no-action.csv' }]);
      await filby.applyYaml(t.name, ADD_ENTITY, yaml);

      const frames = await getDataFrames('2020 VAT Rates');
      deq(frames.map((frame) => frame.action), ['DELETE', 'DELETE', 'DELETE']);
      deq(frames.map((frame) => frame.type), ['standard', 'reduced', 'zero']);
    });

    it('should load a csv with a single column', async (t) => {
      const yaml = transform(ADD_CHANGE_SET_1).set('0.frames', [{ entity: 'VAT Rate', version: 1, action: 'DELETE', source: '../dsl/datafiles/vat-rate-v1-2020-single-column.csv' }]);
      await filby.applyYaml(t.name, ADD_ENTITY, yaml);

      const frames = await getDataFrames('2020 VAT Rates');
      deq(frames.map((frame) => frame.action), ['DELETE']);
      deq(frames.map((frame) => frame.type), ['standard']);
    });

    it('should accept the frame action for csv rows in any case', async (t) => {
      const yaml = transform(ADD_CHANGE_SET_1).set('0.frames', [{ entity: 'VAT Rate', version: 1, action: 'delete', source: '../dsl/datafiles/vat-rate-v1-2020-no-action.csv' }]);
      await filby.applyYaml(t.name, ADD_ENTITY, yaml);

      const frames = await getDataFrames('2020 VAT Rates');
      deq(frames.map((frame) => frame.action), ['DELETE', 'DELETE', 'DELETE']);
    });

    it('should accept csv frame actions in any case', async (t) => {
      const yaml = transform(ADD_CHANGE_SET_1).set('0.frames', [{ entity: 'VAT Rate', version: 1, source: '../dsl/datafiles/vat-rate-v1-2020-mixed-case.csv' }]);
      await filby.applyYaml(t.name, ADD_ENTITY, yaml);

      const frames = await getDataFrames('2020 VAT Rates');
      deq(frames.map((frame) => frame.action), ['SET', 'DELETE', 'SET']);
    });

    it('should reject a frame action when the csv has an action column', async (t) => {
      const yaml = transform(ADD_CHANGE_SET_1).set('0.frames', [{ entity: 'VAT Rate', version: 1, action: 'SET', source: '../dsl/datafiles/vat-rate-v1-2020-set.csv' }]);
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, yaml), (err) => {
        eq(err.message, `Frame for entity 'VAT Rate v1' specifies action 'SET' but ${path.join(__dirname, 'dsl', 'datafiles', 'vat-rate-v1-2020-set.csv')} also has an action column`);
        return true;
      });
    });

    it('should require a frame action when the csv has no action column', async (t) => {
      const yaml = transform(ADD_CHANGE_SET_1).set('0.frames', [{ entity: 'VAT Rate', version: 1, source: '../dsl/datafiles/vat-rate-v1-2020-no-action.csv' }]);
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, yaml), (err) => {
        eq(err.message, `Frame for entity 'VAT Rate v1' does not specify an action and ${path.join(__dirname, 'dsl', 'datafiles', 'vat-rate-v1-2020-no-action.csv')} has no action column`);
        return true;
      });
    });

    it('should reject empty csv action cells', async (t) => {
      const yaml = transform(ADD_CHANGE_SET_1).set('0.frames', [{ entity: 'VAT Rate', version: 1, source: '../dsl/datafiles/vat-rate-v1-2020-empty-action.csv' }]);
      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, yaml), (err) => {
        eq(err.message, `Error parsing ${path.join(__dirname, 'dsl', 'datafiles', 'vat-rate-v1-2020-empty-action.csv')}:3 - Missing action`);
        return true;
      });
    });

    it('should escape data frames in csv files', async (t) => {

      const transforms = [
        (yaml) => transform(yaml).set('2.frames.0.source', '../dsl/datafiles/injection.csv'),
        (yaml) => transform(yaml).del('2.frames.0.action'),
        (yaml) => transform(yaml).del('2.frames.0.data'),
        (yaml) => transform(yaml).del('2.frames.1'),
        (yaml) => transform(yaml).del('2.frames.1'),
      ];

      const yaml = transforms.reduce((document, tx) => {
        return tx(document);
      }, [ADD_ENTITY, ADD_PROJECTION, ADD_CHANGE_SET_1].join('\n'));

      await filby.applyYaml(t.name, yaml);

      const projection = await filby.getProjection('VAT Rates', 1);
      const changeLog = await filby.getChangeLog(projection);

      await filby.withTransaction(async (tx) => {
        const { rows: aggregate1 } = await tx.query('SELECT * FROM get_vat_rate_v1_aggregate($1) ORDER BY rate DESC', [changeLog[0].id]);
        eq(aggregate1.length, 3);
        deq(aggregate1[0], { type: 'standard', rate: 0.10 });
        deq(aggregate1[1], { type: "pwned', 1);RAISE EXCEPTION $💀$You have been pwned!$💀$;", rate: 0.05 });
        deq(aggregate1[2], { type: 'zero', rate: 0 });
      });
    });

    it('should report bad csv files', async (t) => {

      const transforms = [
        (yaml) => transform(yaml).set('2.frames.0.source', '../dsl/datafiles/bad.csv'),
        (yaml) => transform(yaml).del('2.frames.0.action'),
        (yaml) => transform(yaml).del('2.frames.0.data'),
        (yaml) => transform(yaml).del('2.frames.1'),
        (yaml) => transform(yaml).del('2.frames.1'),
      ];

      const yaml = transforms.reduce((document, tx) => {
        return tx(document);
      }, [ADD_ENTITY, ADD_PROJECTION, ADD_CHANGE_SET_1].join('\n'));

      await rejects(() => filby.applyYaml(t.name, yaml), (err) => {
        eq(err.message, `Error parsing ${path.join(__dirname, 'dsl', 'datafiles', 'bad.csv')}:3 - Too few fields: expected 3 fields but parsed 2`);
        return true;
      });
    });

    it('should report missing csv files by their resolved path', async (t) => {

      const transforms = [
        (yaml) => transform(yaml).set('2.frames.0.source', '../dsl/datafiles/missing.csv'),
        (yaml) => transform(yaml).del('2.frames.0.action'),
        (yaml) => transform(yaml).del('2.frames.0.data'),
        (yaml) => transform(yaml).del('2.frames.1'),
        (yaml) => transform(yaml).del('2.frames.1'),
      ];

      const yaml = transforms.reduce((document, tx) => {
        return tx(document);
      }, [ADD_ENTITY, ADD_PROJECTION, ADD_CHANGE_SET_1].join('\n'));

      await rejects(() => filby.applyYaml(t.name, yaml), (err) => {
        eq(err.code, 'ENOENT');
        ok(err.message.includes(path.join(__dirname, 'dsl', 'datafiles', 'missing.csv')), err.message);
        return true;
      });
    });

    it('should store csv values in text columns as the original strings', async (t) => {
      const entity = transform(ADD_ENTITY).set('0.fields', [
        { name: 'type', type: 'TEXT' },
        { name: 'padded', type: 'TEXT' },
        { name: 'exponent', type: 'TEXT' },
        { name: 'decimal', type: 'TEXT' },
        { name: 'flag', type: 'TEXT' },
      ]);
      const changeSet = transform(ADD_CHANGE_SET_1).set('0.frames', [{ entity: 'VAT Rate', version: 1, source: '../dsl/datafiles/typed-values.csv' }]);
      await filby.applyYaml(t.name, entity, changeSet);

      const frames = await getDataFrames('2020 VAT Rates');
      eq(frames.length, 1);
      eq(frames[0].padded, '007');
      eq(frames[0].exponent, '1e3');
      eq(frames[0].decimal, '1.50');
      eq(frames[0].flag, 'TRUE');
    });

    it('should cast csv values to the column type', async (t) => {
      const entity = transform(ADD_ENTITY).set('0.fields', [
        { name: 'type', type: 'TEXT' },
        { name: 'padded', type: 'INTEGER' },
        { name: 'exponent', type: 'NUMERIC' },
        { name: 'decimal', type: 'NUMERIC' },
        { name: 'flag', type: 'BOOLEAN' },
      ]);
      const changeSet = transform(ADD_CHANGE_SET_1).set('0.frames', [{ entity: 'VAT Rate', version: 1, source: '../dsl/datafiles/typed-values.csv' }]);
      await filby.applyYaml(t.name, entity, changeSet);

      const frames = await getDataFrames('2020 VAT Rates');
      eq(frames.length, 1);
      eq(frames[0].padded, 7);
      eq(frames[0].exponent, '1000');
      eq(frames[0].decimal, '1.50');
      eq(frames[0].flag, true);
    });

    it('should store empty csv cells as NULL', async (t) => {
      const entity = transform(ADD_ENTITY).set('0.fields', [
        { name: 'type', type: 'TEXT' },
        { name: 'label', type: 'TEXT' },
        { name: 'quantity', type: 'INTEGER' },
        { name: 'expires', type: 'TIMESTAMPTZ' },
      ]);
      const changeSet = transform(ADD_CHANGE_SET_1).set('0.frames', [{ entity: 'VAT Rate', version: 1, source: '../dsl/datafiles/empty-cells.csv' }]);
      await filby.applyYaml(t.name, entity, changeSet);

      const frames = await getDataFrames('2020 VAT Rates');
      eq(frames.length, 1);
      eq(frames[0].label, null);
      eq(frames[0].quantity, null);
      eq(frames[0].expires, null);
    });

    it('should report csv values that cannot be cast to the column type', async (t) => {
      const entity = transform(ADD_ENTITY).set('0.fields', [
        { name: 'type', type: 'TEXT' },
        { name: 'quantity', type: 'INTEGER' },
      ]);
      const changeSet = transform(ADD_CHANGE_SET_1).set('0.frames', [{ entity: 'VAT Rate', version: 1, source: '../dsl/datafiles/invalid-cast.csv' }]);

      await rejects(() => filby.applyYaml(t.name, entity, changeSet), (err) => {
        eq(err.code, INVALID_TEXT_REPRESENTATION);
        eq(err.message, '001.should-report-csv-values-that-cannot-be-cast-to-the-column-type.yaml: ../dsl/datafiles/invalid-cast.csv:4 - invalid input syntax for type integer: "abc"');
        return true;
      });
    });

    it('should report the csv line of a row beyond the first batch', async (t) => {
      const source = await writeCsv(t.name, 1500);
      await fs.promises.appendFile(path.join(__dirname, 'migrations', source), '\nSET,type-01501,abc');
      const changeSet = transform(ADD_CHANGE_SET_1).set('0.frames', [{ entity: 'VAT Rate', version: 1, source }]);

      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, changeSet), (err) => {
        eq(err.message, `001.should-report-the-csv-line-of-a-row-beyond-the-first-batch.yaml: ${source}:1502 - invalid input syntax for type numeric: "abc"`);
        return true;
      });
    });

    it('should report csv columns that do not exist', async (t) => {
      const changeSet = transform(ADD_CHANGE_SET_1).set('0.frames', [{ entity: 'VAT Rate', version: 1, source: '../dsl/datafiles/unknown-column.csv' }]);

      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, changeSet), (err) => {
        eq(err.message, "Change set '2020 VAT Rates' references a non existent field 'wombat' of entity 'VAT Rate v1'");
        return true;
      });
    });

    it('should load large csv files in a few seconds', async (t) => {
      const source = await writeCsv(t.name, 20000);
      const changeSet = transform(ADD_CHANGE_SET_1).set('0.frames', [{ entity: 'VAT Rate', version: 1, source }]);

      const started = Date.now();
      await filby.applyYaml(t.name, ADD_ENTITY, changeSet);
      const elapsed = Date.now() - started;
      ok(elapsed < 15000, `Loading 20000 rows took ${elapsed}ms`);

      const { rows } = await filby.withTransaction((tx) => tx.query('SELECT type FROM vat_rate_v1 ORDER BY fby_frame_id'));
      eq(rows.length, 20000);
      eq(rows[0].type, 'type-00001');
      eq(rows[19999].type, 'type-20000');
    });

    it('should reject csv rows that repeat a key from an earlier batch', async (t) => {
      const source = await writeCsv(t.name, 1000, 'type-00001');
      const changeSet = transform(ADD_CHANGE_SET_1).set('0.frames', [{ entity: 'VAT Rate', version: 1, source }]);

      await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, changeSet), (err) => {
        eq(err.message, "Entity 'VAT Rate v1' has more than one frame with key (type=type-00001) in change set '2020 VAT Rates'");
        return true;
      });
    });

    it('should make aggregates available from the API', async (t) => {
      await filby.applyYaml(
        t.name,
        ADD_ENTITY,
        ADD_PROJECTION,
        ADD_CHANGE_SET_1,
        ADD_CHANGE_SET_2,
        transform(ADD_CHANGE_SET_3).set('0.frames.1.action', 'DELETE'),
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

    it('should resolve aggregates by entity name regardless of case', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, ADD_CHANGE_SET_1);
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      deq(await filby.getAggregates(changeSetId, 'vat RATE', 1), await filby.getAggregates(changeSetId, 'VAT Rate', 1));
    });

    it('should resolve aggregates for entity names that need quoting', async (t) => {
      const injection = "pwned', 1);RAISE EXCEPTION $💀$You have been pwned!$💀$;";

      await filby.applyYaml(
        t.name,
        transform(ADD_ENTITY).set('0.name', injection),
        transform(ADD_PROJECTION).set('0.dependencies.0.entity', injection),
        transform(ADD_CHANGE_SET_1).set('0.frames', [{ entity: injection, version: 1, action: 'SET', data: [{ type: 'standard', rate: 0.10 }] }]),
      );
      const changeSetId = await getChangeSetId('2020 VAT Rates');

      deq(await filby.getAggregates(changeSetId, injection, 1), [{ type: 'standard', rate: 0.10 }]);
    });
  });

  describe('Migrations', () => {
    it('supports YAML', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY);

      const { rows: entities } = await filby.withTransaction((tx) => tx.query('SELECT name, version FROM fby_entity'));
      eq(entities.length, 1);
      deq(entities[0], { name: 'VAT Rate', version: 1 });
    });

    it('support JSON', async (t) => {
      await filby.applyJson(t.name, `
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
      await filby.applySql(t.name, `
        INSERT INTO fby_entity(id, name, version) VALUES
          (1, 'VAT Rate', 1);
        `);

      const { rows: entities } = await filby.withTransaction((tx) => tx.query('SELECT name, version FROM fby_entity'));
      eq(entities.length, 1);
      deq(entities[0], { name: 'VAT Rate', version: 1 });
    });

    it('should report unsupported file types', async () => {
      const { runMigration } = driver({ database: {} });
      await rejects(() => promisify(runMigration)({ filename: '001.unsupported.avro' }), (err) => {
        eq(err.message, 'Unsupported file type: avro');
        return true;
      });
    });
  });

  async function hasTable(name) {
    const { rows: tables } = await filby.withTransaction((tx) => tx.query('SELECT * FROM information_schema.tables WHERE table_name = $1', [name]));
    return tables.length === 1;
  }

  function vatRate(year, type, rate) {
    return `
- operation: ADD_CHANGE_SET
  description: ${year} VAT Rates
  effective: ${year}-04-05T00:00:00.000Z
  frames:
    - entity: VAT Rate
      version: 1
      action: POST
      data:
        - type: ${type}
          rate: ${rate}`;
  }

  function vatRateWith(field) {
    return `
- operation: ADD_CHANGE_SET
  description: 2020 VAT Rates
  effective: 2020-04-05T00:00:00.000Z
  frames:
    - entity: VAT Rate
      version: 1
      action: SET
      data:
        - type: standard
          rate: 0.2
          ${field}`;
  }

  async function getChangeSets(description) {
    const { rows } = await filby.withTransaction((tx) => tx.query('SELECT id, superseded_by, reissued_from FROM fby_change_set WHERE description = $1 ORDER BY id', [description]));
    return rows;
  }

  async function getChangeSetEntities() {
    const { rows } = await filby.withTransaction((tx) => tx.query(`
      SELECT c.description, e.name, e.version
      FROM fby_change_set_entity ce
      INNER JOIN fby_change_set c ON c.id = ce.change_set_id
      INNER JOIN fby_entity e ON e.id = ce.entity_id
      ORDER BY c.id, e.version`));
    return rows;
  }

  async function getChangeSetId(description) {
    const { rows } = await filby.withTransaction((tx) => tx.query('SELECT id FROM fby_change_set WHERE description = $1', [description]));
    return rows[0].id;
  }

  function setRate(rate) {
    return transform(ADD_CHANGE_SET_1).set('0.frames', [{ entity: 'VAT Rate', version: 1, action: 'SET', data: [{ type: 'standard', rate }] }]);
  }

  async function getRate() {
    const { rows: [row] } = await filby.withTransaction((tx) => tx.query('SELECT rate FROM vat_rate_v1'));
    return row.rate;
  }

  async function getEntityFields() {
    const { rows } = await filby.withTransaction((tx) => tx.query('SELECT position, name, type, identity FROM fby_entity_field ORDER BY position'));
    return rows;
  }

  async function getEntityNullability() {
    const { rows } = await filby.withTransaction((tx) => tx.query('SELECT name, nullable FROM fby_entity_field ORDER BY position'));
    return rows;
  }

  async function hasFunction(name) {
    const { rows: functions } = await filby.withTransaction((tx) => tx.query('SELECT * FROM pg_proc WHERE proname = $1', [name]));
    return functions.length === 1;
  }

  async function getDataFrames(description, tableName = 'vat_rate_v1') {
    const { rows: changeSets } = await filby.withTransaction((tx) => tx.query(`
      SELECT c.description, c.effective, e.name AS entity, e.version, f.action, x.*
      FROM fby_change_set c
      INNER JOIN fby_data_frame f ON f.change_set_id = c.id
      INNER JOIN fby_entity e ON f.entity_id = e.id
      INNER JOIN "${tableName}" x ON x.fby_frame_id = f.id
      WHERE c.description = $1
      ORDER BY x.fby_frame_id ASC`, [description]));
    return changeSets.map((changeSet) => {
      const { fby_frame_id: _frameId, fby_change_set_id: _changeSetId, ...cs } = changeSet;
      return cs;
    });
  }

  async function writeCsv(name, size, ...extraTypes) {
    const filename = `001.${name.replace(/ /g, '-')}.csv`.toLowerCase();
    const types = Array.from({ length: size }, (_, i) => `type-${String(i + 1).padStart(5, '0')}`).concat(extraTypes);
    const lines = ['action,type,rate'].concat(types.map((type, i) => `SET,${type},${(i % 100) / 100}`));
    await fs.promises.writeFile(path.join(__dirname, 'migrations', filename), lines.join('\n'), { encoding: 'utf-8' });
    return `./${filename}`;
  }

  async function getDatabaseTime() {
    const { rows } = await filby.withTransaction((tx) => tx.query('SELECT now()'));
    return rows[0].now;
  }

  async function countNotifications() {
    const { rows } = await filby.withTransaction((tx) => {
      return tx.query('SELECT count(*) AS count FROM fby_notification');
    });
    return Number(rows[0].count);
  }

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
});

function loadYaml(filename) {
  return fs.readFileSync(path.join(__dirname, 'dsl', 'snippets', `${filename}.yaml`), { encoding: 'utf-8' });
}

function assertNotification(actual, expected) {
  eq(actual.hook_name, actual.hook_name);
  eq(actual.hook_event, actual.hook_event);
  eq(actual.projection_name, actual.projection_name);
  eq(actual.projection_version, actual.projection_version);
  ok(actual.scheduled_for >= expected.scheduled_for);
  eq(actual.attempts, actual.attempts);
  eq(actual.status, actual.status);
  eq(actual.last_attempted, actual.last_attempted);
  eq(actual.last_error, actual.last_error);
}
