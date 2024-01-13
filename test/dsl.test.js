const fs = require('node:fs');
const path = require('node:path');
const { ok, strictEqual: eq, deepEqual: deq, rejects, match } = require('node:assert');
const { describe, it, before, beforeEach, after, afterEach } = require('zunit');

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

  describe('Enums', () => {
    it('should add enums', async (t) => {
      await applyYaml(t.name, `
        add enums:
        - name: vat_tax_rate
          values:
            - standard
            - reduced
            - zero
      `);
      const { rows: labels } = await filby.withTransaction((tx) => tx.query("SELECT enumlabel AS label FROM pg_enum WHERE enumtypid = 'vat_tax_rate'::regtype"));

      eq(labels.length, 3);
      deq(labels[0], { label: 'standard' });
      deq(labels[1], { label: 'reduced' });
      deq(labels[2], { label: 'zero' });
    });

    it('should require a name', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add enums:
          - values:
            - standard
            - reduced
            - zero
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-a-name.yaml: /add_enums/0 must have required property 'name'"));
        return true;
      });
    });

    it('should require at least one value', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add enums:
          - name: vat_tax_rate
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-at-least-one-value.yaml: /add_enums/0 must have required property 'values'"));
        return true;
      });

      await rejects(() => applyYaml(t.name, `
        add enums:
          - name: vat_tax_rate
            values:
      `), (err) => {
        match(err.message, new RegExp('^001.should-require-at-least-one-value.yaml: /add_enums/0/values must be an array'));
        return true;
      });
    });
  });

  describe('Projections', () => {
    it('should add projections', async (t) => {
      await applyYaml(t.name, `
        add entities:
        - name: VAT Rate
          version: 1
          fields:
          - name: type
            type: TEXT
          - name: rate
            type: NUMERIC
          identified by:
          - type

        add projections:
        - name: VAT Rates
          version: 1
          dependencies:
          - entity: VAT Rate
            version: 1
        `);
      const { rows: projections } = await filby.withTransaction((tx) => tx.query('SELECT name, version FROM fby_projection'));

      eq(projections.length, 1);
      deq(projections[0], { name: 'VAT Rates', version: 1 });
    });

    it('should require a name', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add projections:
          - version: 1
            dependencies:
            - entity: VAT Rate
              version: 1
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-a-name.yaml: /add_projections/0 must have required property 'name'"));
        return true;
      });
    });

    it('should require a version', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add projections:
          - name: VAT Rates
            dependencies:
            - entity: VAT Rate
              version: 1
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-a-version.yaml: /add_projections/0 must have required property 'version'"));
        return true;
      });
    });

    it('should require at least one dependency', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add projections:
          - name: VAT Rates
            version: 1
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-at-least-one-dependency.yaml: /add_projections/0 must have required property 'dependencies'"));
        return true;
      });

      await rejects(() => applyYaml(t.name, `
        add projections:
          - name: VAT Rates
            version: 1
            dependencies:
      `), (err) => {
        match(err.message, new RegExp('001.should-require-at-least-one-dependency.yaml: /add_projections/0/dependencies must be an array'));
        return true;
      });
    });

    it('should require valid dependencies', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add projections:
          - name: VAT Rates
            version: 1
            dependencies:
            - version: 1
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-valid-dependencies.yaml: /add_projections/0/dependencies/0 must have required property 'entity'"));
        return true;
      });

      await rejects(() => applyYaml(t.name, `
        add projections:
          - name: VAT Rates
            version: 1
            dependencies:
            - entity: VAT Rate
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-valid-dependencies.yaml: /add_projections/0/dependencies/0 must have required property 'version'"));
        return true;
      });
    });
  });

  describe('Entities', () => {
    it('should add entities', async (t) => {
      await applyYaml(t.name, `
        add entities:
        - name: VAT Rate
          version: 1
          fields:
          - name: type
            type: TEXT
          - name: rate
            type: NUMERIC
          identified by:
          - type
      `);

      const { rows: entities } = await filby.withTransaction((tx) => tx.query('SELECT name, version FROM fby_entity'));

      eq(entities.length, 1);
      deq(entities[0], { name: 'VAT Rate', version: 1 });
    });

    it('should require a name', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add entities:
        - version: 1
          fields:
          - name: type
            type: TEXT
          identified by:
          - type
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-a-name.yaml: /add_entities/0 must have required property 'name'"));
        return true;
      });
    });

    it('should require a version', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add entities:
        - name: VAT Rate
          fields:
          - name: type
            type: TEXT
          identified by:
          - type
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-a-version.yaml: /add_entities/0 must have required property 'version'"));
        return true;
      });
    });

    it('should require at least one field', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add entities:
        - name: VAT Rate
          version: 1
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-at-least-one-field.yaml: /add_entities/0 must have required property 'fields'"));
        return true;
      });

      await rejects(() => applyYaml(t.name, `
        add entities:
        - name: VAT Rate
          version: 1
          fields:
          identified by:
          - type
      `), (err) => {
        match(err.message, new RegExp('^001.should-require-at-least-one-field.yaml: /add_entities/0/fields must be an array'));
        return true;
      });
    });

    it('should require valid fields', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add entities:
        - name: VAT Rate
          version: 1
          fields:
          - type: TEXT
          identified by:
          - type
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-valid-fields.yaml: /add_entities/0/fields/0 must have required property 'name'"));
        return true;
      });

      await rejects(() => applyYaml(t.name, `
        add entities:
        - name: VAT Rate
          version: 1
          fields:
          - name: type
          identified by:
          - type
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-valid-fields.yaml: /add_entities/0/fields/0 must have required property 'type'"));
        return true;
      });

      await rejects(() => applyYaml(t.name, `
        add entities:
        - name: VAT Rate
          version: 1
          fields:
          - name: type
            type: UNSUPPORTED BY POSTGRES
          identified by:
          - type
      `), (err) => {
        eq(err.code, '42601');
        return true;
      });
    });

    it('should require at least one identifier column', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add entities:
        - name: VAT Rate
          version: 1
          fields:
          - name: type
            type: TEXT
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-at-least-one-identifier-column.yaml: /add_entities/0 must have required property 'identified by' or 'identified_by'"));
        return true;
      });

      await rejects(() => applyYaml(t.name, `
        add entities:
        - name: VAT Rate
          version: 1
          fields:
          - name: type
            type: TEXT
          identified by:
      `), (err) => {
        match(err.message, new RegExp('001.should-require-at-least-one-identifier-column.yaml: /add_entities/0/identified_by must be an array'));
        return true;
      });
    });
  });

  describe('Change Sets', () => {
    it('should require an effective date', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add change sets:
          - frames:
          - entity: VAT Rate
            version: 1
            action: POST
            data:
            - type: standard
              rate: 0.10
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-an-effective-date.yaml: /add_change_sets/0 must have required property 'effective'"));
        return true;
      });
    });

    it('should require at least one frame', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add change sets:
        - effective: 2020-04-05T00:00:00.000Z
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-at-least-one-frame.yaml: /add_change_sets/0 must have required property 'frames'"));
        return true;
      });

      await rejects(() => applyYaml(t.name, `
        add change sets:
        - effective: 2020-04-05T00:00:00.000Z
          frames:
      `), (err) => {
        match(err.message, new RegExp('^001.should-require-at-least-one-frame.yaml: /add_change_sets/0/frames must be an array'));
        return true;
      });
    });

    it('should require frames to specify an entity name', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add change sets:
        - effective: 2020-04-05T00:00:00.000Z
          frames:
          - version: 1
            action: POST
            data:
            - type: standard
              rate: 0.10
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-frames-to-specify-an-entity-name.yaml: /add_change_sets/0/frames/0 must have required property 'entity'"));
        return true;
      });
    });

    it('should require frames to specify an entity version', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add change sets:
        - effective: 2020-04-05T00:00:00.000Z
          frames:
          - entity: VAT Rate
            action: POST
            data:
            - type: standard
              rate: 0.10
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-frames-to-specify-an-entity-version.yaml: /add_change_sets/0/frames/0 must have required property 'version'"));
        return true;
      });
    });

    it('should require frames to specify a valid action', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add change sets:
        - effective: 2020-04-05T00:00:00.000Z
          frames:
          - entity: VAT Rate
            version: 1
            data:
            - type: standard
              rate: 0.10
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-frames-to-specify-a-valid-action.yaml: /add_change_sets/0/frames/0 must have required property 'source' or 'action'"));
        return true;
      });

      await rejects(() => applyYaml(t.name, `
        add change sets:
        - effective: 2020-04-05T00:00:00.000Z
          frames:
          - entity: VAT Rate
            version: 1
            action: MEH
            data:
            - type: standard
              rate: 0.10
      `), (err) => {
        match(err.message, new RegExp('^001.should-require-frames-to-specify-a-valid-action.yaml: /add_change_sets/0/frames/0/action must be equal to one of the allowed values: POST, DELETE'));
        return true;
      });
    });

    it('should require frame data to specify at least one value', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add change sets:
        - effective: 2020-04-05T00:00:00.000Z
          frames:
          - entity: VAT Rate
            version: 1
            action: POST
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-frame-data-to-specify-at-least-one-value.yaml: /add_change_sets/0/frames/0 must have required property 'source' or 'data'"));
        return true;
      });

      await rejects(() => applyYaml(t.name, `
        add change sets:
        - effective: 2020-04-05T00:00:00.000Z
          frames:
          - entity: VAT Rate
            version: 1
            action: POST
            data:
      `), (err) => {
        match(err.message, new RegExp('^001.should-require-frame-data-to-specify-at-least-one-value.yaml: /add_change_sets/0/frames/0/data must be an array'));
        return true;
      });
    });
  });

  describe('Aggregates', () => {
    it('should aggregate data frames up to the specified change set', async (t) => {
      await applyYaml(t.name, `
        add projections:
        - name: VAT Rates
          version: 1
          dependencies:
          - entity: VAT Rate
            version: 1

        add entities:
        - name: VAT Rate
          version: 1
          fields:
          - name: type
            type: TEXT
          - name: rate
            type: NUMERIC
          identified by:
          - type

        add change sets:
        - description: 2020 VAT Rates
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

        - description: 2021 VAT Rates
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
          - entity: VAT Rate
            version: 1
            action: POST
            data:
            - type: zero
              rate: 0

        - description: 2022 VAT Rates
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
          - entity: VAT Rate
            version: 1
            action: POST
            data:
            - type: zero
              rate: 0
      `);

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
      await applyYaml(t.name, `
        add projections:
        - name: VAT Rates
          version: 1
          dependencies:
          - entity: VAT Rate
            version: 1

        add entities:
        - name: VAT Rate
          version: 1
          fields:
          - name: type
            type: TEXT
          - name: rate
            type: NUMERIC
          identified by:
          - type

        add change sets:
        - description: 2020 VAT Rates
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

        - description: 2021 VAT Rates
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
          - entity: VAT Rate
            version: 1
            action: POST
            data:
            - type: zero
              rate: 0

        - description: 2022 VAT Rates
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
          - entity: VAT Rate
            version: 1
            action: DELETE
            data:
            - type: zero
      `);

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
        deq(aggregate3[1], { type: 'reduced', rate: 0.10 });
      });
    });

    it('should load data frames from csv files', async (t) => {
      await applyYaml(t.name, `
        add projections:
        - name: VAT Rates
          version: 1
          dependencies:
          - entity: VAT Rate
            version: 1

        add entities:
        - name: VAT Rate
          version: 1
          fields:
          - name: type
            type: TEXT
          - name: rate
            type: NUMERIC
          identified by:
          - type

        add change sets:
        - description: 2020 VAT Rates
          effective: 2020-04-05T00:00:00.000Z
          frames:
          - entity: VAT Rate
            version: 1
            source: ./test/dsl/datafiles/vat-rate-v1-2020.csv
        - description: 2021 VAT Rates
          effective: 2021-04-05T00:00:00.000Z
          frames:
          - entity: VAT Rate
            version: 1
            source: ./test/dsl/datafiles/vat-rate-v1-2021.csv
        - description: 2021 VAT Rates
          effective: 2022-04-05T00:00:00.000Z
          frames:
          - entity: VAT Rate
            version: 1
            source: ./test/dsl/datafiles/vat-rate-v1-2022.csv
      `);

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
        deq(aggregate3[1], { type: 'reduced', rate: 0.10 });
      });
    });

    it('should report bad csv files', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add projections:
        - name: VAT Rates
          version: 1
          dependencies:
          - entity: VAT Rate
            version: 1

        add entities:
        - name: VAT Rate
          version: 1
          fields:
          - name: type
            type: TEXT
          - name: rate
            type: NUMERIC
          identified by:
          - type

        add change sets:
        - description: 2020 VAT Rates
          effective: 2020-04-05T00:00:00.000Z
          frames:
          - entity: VAT Rate
            version: 1
            source: ./test/dsl/datafiles/bad.csv
      `), (err) => {
        eq(err.message, 'Error parsing ./test/dsl/datafiles/bad.csv:3 - Too few fields: expected 3 fields but parsed 2');
        return true;
      });
    });

    it('should make aggregates available from the API', async (t) => {
      await applyYaml(t.name, `
        add projections:
        - name: VAT Rates
          version: 1
          dependencies:
          - entity: VAT Rate
            version: 1

        add entities:
        - name: VAT Rate
          version: 1
          fields:
          - name: type
            type: TEXT
          - name: rate
            type: NUMERIC
          identified by:
          - type

        add change sets:
        - description: 2020 VAT Rates
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

        - description: 2021 VAT Rates
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
          - entity: VAT Rate
            version: 1
            action: POST
            data:
            - type: zero
              rate: 0

        - description: 2022 VAT Rates
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
          - entity: VAT Rate
            version: 1
            action: DELETE
            data:
            - type: zero
      `);

      const projection = await filby.getProjection('VAT Rates', 1);
      const changeLog = await filby.getChangeLog(projection);

      const aggregate1 = await filby.getAggregates(changeLog[0].id, 'VAT Rate', 1);
      eq(aggregate1.length, 3);
      deq(aggregate1[0], { type: 'reduced', rate: 0.05 });
      deq(aggregate1[1], { type: 'standard', rate: 0.10 });
      deq(aggregate1[2], { type: 'zero', rate: 0 });

      const aggregate3 = await filby.getAggregates(changeLog[2].id, 'VAT Rate', 1);
      eq(aggregate3.length, 2);
      deq(aggregate3[0], { type: 'reduced', rate: 0.1 });
      deq(aggregate3[1], { type: 'standard', rate: 0.15 });
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

  describe('migrations', () => {
    it('supports YAML', async (t) => {
      await applyYaml(t.name, `
        add entities:
        - name: VAT Rate
          version: 1
          fields:
          - name: type
            type: TEXT
          - name: rate
            type: NUMERIC
          identified by:
          - type
      `);

      const { rows: entities } = await filby.withTransaction((tx) => tx.query('SELECT name, version FROM fby_entity'));

      eq(entities.length, 1);
      deq(entities[0], { name: 'VAT Rate', version: 1 });
    });

    it('supports JSON', async (t) => {
      await applyJson(t.name, `
        {
          "add_entities": [
            {
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
              "identified by": [
                "type"
              ]
            }
          ]
        }
      `);

      const { rows: entities } = await filby.withTransaction((tx) => tx.query('SELECT name, version FROM fby_entity'));

      eq(entities.length, 1);
      deq(entities[0], { name: 'VAT Rate', version: 1 });
    });

    it('supports SQL', async (t) => {
      await applySql(t.name, `
        INSERT INTO fby_entity (id, name, version) VALUES
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

  describe('Hooks', () => {
    it('should add hooks', async (t) => {
      await applyYaml(t.name, `
        add entities:
        - name: VAT Rate
          version: 1
          fields:
          - name: type
            type: TEXT
          - name: rate
            type: NUMERIC
          identified by:
          - type

        add projections:
        - name: VAT Rates
          version: 1
          dependencies:
          - entity: VAT Rate
            version: 1

        add hooks:
        - projection: VAT Rates
          version: 1
          event: VAT Rates Change
        - event: Any Change
      `);

      const { rows: hooks } = await filby.withTransaction((tx) => tx.query('SELECT name, version, event FROM fby_hook h LEFT JOIN fby_projection p ON h.projection_id = p.id'));

      eq(hooks.length, 2);
      deq(hooks[0], { name: 'VAT Rates', version: 1, event: 'VAT Rates Change' });
      deq(hooks[1], { name: null, version: null, event: 'Any Change' });
    });

    it('should require a projection', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add hooks:
        - version: 1
          event: VAT Rates Change
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-a-projection.yaml: /add_hooks/0 must have required property 'projection'"));
        return true;
      });
    });

    it('should require a version', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add hooks:
        - projection: VAT Rates
          event: VAT Rates Change
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-a-version.yaml: /add_hooks/0 must have required property 'version'"));
        return true;
      });
    });

    it('should require an event', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add hooks:
        - projection: VAT Rate
          version: 1
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-an-event.yaml: /add_hooks/0 must have required property 'event'"));
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
    fs.writeFileSync(path.join(__dirname, 'dsl', `001.${name.replace(/ /g, '-')}.${extension}`), script, { encoding: 'utf-8' });
    return filby.init();
  }

  function deleteMigrations() {
    fs.readdirSync(path.join(__dirname, 'dsl'))
      .filter((file) => ['.yaml', '.json', '.sql', '.yml'].includes(path.extname(file).toLowerCase()))
      .map((file) => path.join(__dirname, 'dsl', file))
      .forEach((file) => fs.unlinkSync(file));
  }

});
