const fs = require('node:fs');
const path = require('node:path');
const { ok, strictEqual: eq, deepEqual: deq, rejects, match } = require('node:assert');
const { describe, it, before, beforeEach, after, afterEach } = require('zunit');
const YAML = require('yaml');
const op = require('object-path-immutable');
const { PostgresError: { INVALID_NAME, SYNTAX_ERROR, CHECK_VIOLATION } } = require('pg-error-enum');

const TestFilby = require('./TestFilby');
const { table } = require('../lib/helpers');

const config = {
  nukeCustomObjects: async (tx) => {
    await tx.query('DROP TABLE IF EXISTS vat_rate_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_vat_rate_v1_aggregate');
    await tx.query('DROP TABLE IF EXISTS vat_rate_v2');
    await tx.query('DROP FUNCTION IF EXISTS get_vat_rate_v2_aggregate');
    await tx.query('DROP TABLE IF EXISTS cgt_rate_v1');
    await tx.query('DROP FUNCTION IF EXISTS get_cgt_rate_v1_aggregate');
    await tx.query('DROP TYPE IF EXISTS vat_tax_rate');
    await tx.query('DROP TYPE IF EXISTS cgt_tax_rate');
    await tx.query('DROP TYPE IF EXISTS pwned');
    await tx.query('DROP TYPE IF EXISTS "pwned_as_enum_();_raise_exception_$💀$you_have_been_pwned!$💀$;_create_type_vat_tax_rate"');
    await tx.query('DROP TABLE IF EXISTS "pwned\',_1);raise_exception_$💀$you_have_been_pwned!$💀$;_v1"');
    await tx.query('DROP FUNCTION IF EXISTS "get_pwned\',_1);raise_exception_$💀$you_have_been_pwned!$💀$;_v1_aggregate"');
  },
};

const ADD_ENUM = loadYaml('ADD_ENUM');
const DROP_ENUM = loadYaml('DROP_ENUM');
const ADD_ENTITY = loadYaml('ADD_ENTITY');
const DROP_ENTITY = loadYaml('DROP_ENTITY');
const ADD_PROJECTION = loadYaml('ADD_PROJECTION');
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
        eq(err.message, "001.should-report-unknown-terms.yaml: /0/operation must be equal to one of the allowed values 'ADD_ENUM', 'ADD_ENTITY', 'ADD_PROJECTION', 'ADD_HOOK', 'ADD_CHANGE_SET', 'DROP_ENUM', 'DROP_ENTITY', 'DROP_PROJECTION' or 'DROP_HOOK'");
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

    it('should reject operation when not permitted', async (t) => {
      const testConfig = op.set(config, 'migrations.0', { path: 'test/migrations', permissions: [] });
      await withFilby(testConfig, async () => {
        await rejects(() => filby.applyYaml(t.name, ADD_ENUM), (err) => {
          eq(err.message, "001.should-reject-operation-when-not-permitted.yaml: Operation 'ADD_ENUM' is not permitted");
          return true;
        });
      });
    });

    it('should add enum', async (t) => {
      await filby.applyYaml(t.name, ADD_ENUM);

      const { rows: labels } = await filby.withTransaction((tx) => tx.query("SELECT enumlabel AS label FROM pg_enum WHERE enumtypid = 'vat_tax_rate'::regtype"));
      eq(labels.length, 3);
      deq(labels[0], { label: 'standard' });
      deq(labels[1], { label: 'reduced' });
      deq(labels[2], { label: 'zero' });
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

  describe('Drop Enum', () => {

    it('should reject operation when not permitted', async (t) => {
      const testConfig = op.set(config, 'migrations.0', { path: 'test/migrations', permissions: ['ADD_ENUM'] });
      await withFilby(testConfig, async () => {
        await rejects(() => filby.applyYaml(t.name, ADD_ENUM, DROP_ENUM), (err) => {
          eq(err.message, "001.should-reject-operation-when-not-permitted.yaml: Operation 'DROP_ENUM' is not permitted");
          return true;
        });
      });
    });

    it('should drop enum', async (t) => {
      await filby.applyYaml(t.name, ADD_ENUM, DROP_ENUM);

      const { rows: enums } = await filby.withTransaction((tx) => tx.query("SELECT * FROM pg_type WHERE typname LIKE '%_tax_rate' AND typtype = 'e'"));
      eq(enums.length, 0);
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

    it('should reject operation when not permitted', async (t) => {
      const testConfig = op.set(config, 'migrations.0', { path: 'test/migrations', permissions: [] });
      await withFilby(testConfig, async () => {
        await rejects(() => filby.applyYaml(t.name, ADD_ENTITY), (err) => {
          eq(err.message, "001.should-reject-operation-when-not-permitted.yaml: Operation 'ADD_ENTITY' is not permitted");
          return true;
        });
      });
    });

    it('should add entity', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY);

      const { rows: entities } = await filby.withTransaction((tx) => tx.query('SELECT name, version FROM fby_entity'));
      eq(entities.length, 1);
      deq(entities[0], { name: 'VAT Rate', version: 1 });
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

    it('should require a version', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).del('0.version')), (err) => {
        eq(err.message, "001.should-require-a-version.yaml: /0 must have required property 'version'");
        return true;
      });
    });

    it('should require version to be an integer', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_ENTITY).set('0.version', 1.1)), (err) => {
        eq(err.message, "001.should-require-version-to-be-an-integer.yaml: /0/version must be of type 'integer'");
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

      const { rows: columns } = await filby.withTransaction((tx) => tx.query("SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'vat_rate_v1';"));
      eq(columns.length, 3);
      eq(columns[1].name, "pwned',_1);raise_exception_$💀$you_have_been_pwned!$💀$;");
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
        eq(err.message, "Invalid PostgreSQL TYPE 'TEXT);RAISE EXCEPTION $💀$You have been pwned!$💀$;'");
        return true;
      });
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

    it('should reject checks when not permitted', async (t) => {
      const testConfig = op.set(config, 'migrations.0', { path: 'test/migrations', permissions: ['ADD_ENTITY'] });
      await withFilby(testConfig, async () => {
        await rejects(() => filby.applyYaml(
          t.name,
          transform(ADD_ENTITY).merge('0.checks', { max_rate: '(rate <= 1)' }),
        ), (err) => {
          eq(err.message, '001.should-reject-checks-when-not-permitted.yaml: entity check constraints are not permitted');
          return true;
        });
      });
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

    it('should reject operation when not permitted', async (t) => {
      const testConfig = op.set(config, 'migrations.0', { path: 'test/migrations', permissions: ['ADD_ENTITY'] });
      await withFilby(testConfig, async () => {
        await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, DROP_ENTITY), (err) => {
          eq(err.message, "001.should-reject-operation-when-not-permitted.yaml: Operation 'DROP_ENTITY' is not permitted");
          return true;
        });
      });
    });

    it('should drop entity', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY);

      ok(await hasTable('vat_rate_v1'));
      ok(await hasFunction('get_vat_rate_v1_aggregate'));

      await filby.applyYaml(t.name, DROP_ENTITY);

      ok(!await hasTable('vat_rate_v1'));
      ok(!await hasFunction('get_vat_rate_v1_aggregate'));
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

    it('should reject operation when not permitted', async (t) => {
      const testConfig = op.set(config, 'migrations.0', { path: 'test/migrations', permissions: ['ADD_ENTITY'] });
      await withFilby(testConfig, async () => {
        await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION), (err) => {
          eq(err.message, "001.should-reject-operation-when-not-permitted.yaml: Operation 'ADD_PROJECTION' is not permitted");
          return true;
        });
      });
    });

    it('should add projection', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION);
      const { rows: projections } = await filby.withTransaction((tx) => tx.query('SELECT name, version FROM fby_projection'));

      eq(projections.length, 1);
      deq(projections[0], { name: 'VAT Rates', version: 1 });
    });

    it('should schedule notifications', async (t) => {
      const checkpoint = new Date();
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

    it('should require a version', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_PROJECTION).del('0.version')), (err) => {
        eq(err.message, "001.should-require-a-version.yaml: /0 must have required property 'version'");
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
  });

  describe('Drop Projection', () => {

    it('should reject operation when not permitted', async (t) => {
      const testConfig = op.set(config, 'migrations.0', { path: 'test/migrations', permissions: ['ADD_ENTITY', 'ADD_PROJECTION'] })
      await withFilby(testConfig, async () => {
        await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, DROP_PROJECTION), (err) => {
          eq(err.message, "001.should-reject-operation-when-not-permitted.yaml: Operation 'DROP_PROJECTION' is not permitted");
          return true;
        });
      });
    });

    it('should drop projection', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, DROP_PROJECTION);
      const { rows: projections } = await filby.withTransaction((tx) => tx.query('SELECT * FROM fby_projection'));
      eq(projections.length, 0);
    });

    it('should schedule notifications', async (t) => {
      const checkpoint = new Date();
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

    it('should reject operation when not permitted', async (t) => {
      const testConfig = op.set(config, 'migrations.0', { path: 'test/migrations', permissions: ['ADD_ENTITY'] });
      await withFilby(testConfig, async () => {
        await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, ADD_CHANGE_SET_1), (err) => {
          eq(err.message, "001.should-reject-operation-when-not-permitted.yaml: Operation 'ADD_CHANGE_SET' is not permitted");
          return true;
        });
      });
    });

    it('should add a change set', async (t) => {
      await filby.applyYaml(t.name, ADD_ENTITY, ADD_CHANGE_SET_1);

      const frames = await getDataFrames('2020 VAT Rates');
      eq(frames.length, 3);
      deq(frames[0], {
        description: '2020 VAT Rates',
        effective: new Date('2020-04-05T00:00:00.000Z'),
        entity: 'VAT Rate',
        version: 1,
        action: 'POST',
        type: 'standard',
        rate: 0.10,
      });
    });

    it('should schedule notifications', async (t) => {
      const checkpoint = new Date();
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
        action: 'POST',
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
        eq(err.message, "001.should-require-effective-to-be-an-iso-date.yaml: /0/effective must match format 'date-time'");
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
        action: 'POST',
        type: 'standard',
        rate: 0.10,
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

    it('should require frame action to be a string', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).set('0.frames.0.action', 1)), (err) => {
        eq(err.message, "001.should-require-frame-action-to-be-a-string.yaml: /0/frames/0/action must be of type 'string'");
        return true;
      });
    });

    it('should require frame action to be POST or DELETE', async (t) => {
      await rejects(() => filby.applyYaml(t.name, transform(ADD_CHANGE_SET_1).set('0.frames.0.action', 'GET')), (err) => {
        eq(err.message, "001.should-require-frame-action-to-be-post-or-delete.yaml: /0/frames/0/action must be equal to one of the allowed values 'POST' or 'DELETE'");
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
        action: 'POST',
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
        action: 'POST',
        type: 'standard',
        rate: 0.10,
        pwned: injection,
      });
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
  });

  describe('Add Hook', () => {

    it('should reject operation when not permitted', async (t) => {
      const testConfig = op.set(config, 'migrations.0', { path: 'test/migrations', permissions: ['ADD_ENTITY', 'ADD_PROJECTION'] });
      await withFilby(testConfig, async () => {
        await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, ADD_HOOK_ADD_PROJECTION), (err) => {
          eq(err.message, "001.should-reject-operation-when-not-permitted.yaml: Operation 'ADD_HOOK' is not permitted");
          return true;
        });
      });
    });

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
          eq(err.message, "001.should-require-event-to-be-valid.yaml: /0/event must be equal to one of the allowed values 'ADD_PROJECTION', 'DROP_PROJECTION' or 'ADD_CHANGE_SET'");
          return true;
        });
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
          eq(err.message, "Hook 'sns/add-change-set/vat-rates-v1' references a non existent projection 'wombat v1'");
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
          eq(err.message, "001.should-require-event-to-be-valid.yaml: /0/event must be equal to one of the allowed values 'ADD_PROJECTION', 'DROP_PROJECTION' or 'ADD_CHANGE_SET'");
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

    it('should reject operation when not permitted', async (t) => {
      const testConfig = op.set(config, 'migrations.0', { path: 'test/migrations', permissions: ['ADD_ENTITY', 'ADD_PROJECTION', 'ADD_HOOK'] });
      await withFilby(testConfig, async () => {
        await rejects(() => filby.applyYaml(t.name, ADD_ENTITY, ADD_PROJECTION, ADD_HOOK_CHANGE_SET_PROJECTION, DROP_HOOK_ADD_CHANGE_SET_PROJECTION), (err) => {
          eq(err.message, "001.should-reject-operation-when-not-permitted.yaml: Operation 'DROP_HOOK' is not permitted");
          return true;
        });
      });
    });

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

    it('should escape data frames in csv files', async (t) => {

      const transforms = [
        (yaml) => transform(yaml).set('2.frames.0.source', './test/dsl/datafiles/injection.csv'),
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
        (yaml) => transform(yaml).set('2.frames.0.source', './test/dsl/datafiles/bad.csv'),
        (yaml) => transform(yaml).del('2.frames.0.action'),
        (yaml) => transform(yaml).del('2.frames.0.data'),
        (yaml) => transform(yaml).del('2.frames.1'),
        (yaml) => transform(yaml).del('2.frames.1'),
      ];

      const yaml = transforms.reduce((document, tx) => {
        return tx(document);
      }, [ADD_ENTITY, ADD_PROJECTION, ADD_CHANGE_SET_1].join('\n'));

      await rejects(() => filby.applyYaml(t.name, yaml), (err) => {
        eq(err.message, 'Error parsing ./test/dsl/datafiles/bad.csv:3 - Too few fields: expected 3 fields but parsed 2');
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

    it('reject SQL when not permitted', async (t) => {
      const testConfig = op.set(config, 'migrations.0', { path: 'test/migrations', permissions: ['ALL_OPERATIONS'] });
      await withFilby(testConfig, async () => {
        await rejects(() => filby.applySql(t.name, `
        INSERT INTO fby_entity(id, name, version) VALUES
          (1, 'VAT Rate', 1);
        `), (err) => {
          eq(err.message, '001.reject-sql-when-not-permitted.sql: SQL migrations are not permitted');
          return true;
        });
      });
    });

    it('should report unsupported file types', async (t) => {
      await rejects(() => filby.apply(t.name, 'UNSUPPORTED', 'avro'), (err) => {
        eq(err.message, 'Unsupported file type: avro');
        return true;
      });
    });
  });

  async function hasTable(name) {
    const { rows: tables } = await filby.withTransaction((tx) => tx.query('SELECT * FROM information_schema.tables WHERE table_name = $1', [name]));
    return tables.length === 1;
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
      const { fby_frame_id: _, ...cs } = changeSet;
      return cs;
    });
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

  async function withFilby(customConfig, fn) {
    const backup = filby;
    filby = new TestFilby(customConfig);
    try {
      await fn();
    } finally {
      await filby.stop();
      filby = backup;
    }
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
