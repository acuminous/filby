const fs = require('node:fs');
const path = require('node:path');
const {
  ok, strictEqual: eq, deepEqual: deq, rejects, throws, match,
} = require('node:assert');
const {
  describe, it, before, beforeEach, after, afterEach,
} = require('zunit');

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

  describe('Projections', () => {
    it('should add projections', async (t) => {
      await applyYaml(t.name, `
        define entities:
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
        define entities:
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
        define entities:
        - version: 1
          fields:
          - name: type
            type: TEXT
          identified by:
          - type
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-a-name.yaml: /define_entities/0 must have required property 'name'"));
        return true;
      });
    });

    it('should require a version', async (t) => {
      await rejects(() => applyYaml(t.name, `
        define entities:
        - name: VAT Rate
          fields:
          - name: type
            type: TEXT
          identified by:
          - type
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-a-version.yaml: /define_entities/0 must have required property 'version'"));
        return true;
      });
    });

    it('should require at least one field', async (t) => {
      await rejects(() => applyYaml(t.name, `
        define entities:
        - name: VAT Rate
          version: 1
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-at-least-one-field.yaml: /define_entities/0 must have required property 'fields'"));
        return true;
      });

      await rejects(() => applyYaml(t.name, `
        define entities:
        - name: VAT Rate
          version: 1
          fields:
          identified by:
          - type
      `), (err) => {
        match(err.message, new RegExp('^001.should-require-at-least-one-field.yaml: /define_entities/0/fields must be an array'));
        return true;
      });
    });

    it('should require valid fields', async (t) => {
      await rejects(() => applyYaml(t.name, `
        define entities:
        - name: VAT Rate
          version: 1
          fields:
          - type: TEXT
          identified by:
          - type
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-valid-fields.yaml: /define_entities/0/fields/0 must have required property 'name'"));
        return true;
      });

      await rejects(() => applyYaml(t.name, `
        define entities:
        - name: VAT Rate
          version: 1
          fields:
          - name: type
          identified by:
          - type
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-valid-fields.yaml: /define_entities/0/fields/0 must have required property 'type'"));
        return true;
      });

      await rejects(() => applyYaml(t.name, `
        define entities:
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
        define entities:
        - name: VAT Rate
          version: 1
          fields:
          - name: type
            type: TEXT
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-at-least-one-identifier-column.yaml: /define_entities/0 must have required property 'identified by' or 'identified_by'"));
        return true;
      });

      await rejects(() => applyYaml(t.name, `
        define entities:
        - name: VAT Rate
          version: 1
          fields:
          - name: type
            type: TEXT
          identified by:
      `), (err) => {
        match(err.message, new RegExp('001.should-require-at-least-one-identifier-column.yaml: /define_entities/0/identified_by must be an array'));
        return true;
      });
    });
  });

  describe('Change Sets', () => {
    it('should require an effective date', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add change set:
          - frames:
          - entity: VAT Rate
            version: 1
            action: POST
            data:
            - type: standard
              rate: 0.10
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-an-effective-date.yaml: /add_change_set/0 must have required property 'effective'"));
        return true;
      });
    });

    it('should require at least one frame', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add change set:
        - effective: 2020-04-05T00:00:00.000Z
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-at-least-one-frame.yaml: /add_change_set/0 must have required property 'frames'"));
        return true;
      });

      await rejects(() => applyYaml(t.name, `
        add change set:
        - effective: 2020-04-05T00:00:00.000Z
          frames:
      `), (err) => {
        match(err.message, new RegExp('^001.should-require-at-least-one-frame.yaml: /add_change_set/0/frames must be an array'));
        return true;
      });
    });

    it('should require frames to specify an entity name', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add change set:
        - effective: 2020-04-05T00:00:00.000Z
          frames:
          - version: 1
            action: POST
            data:
            - type: standard
              rate: 0.10
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-frames-to-specify-an-entity-name.yaml: /add_change_set/0/frames/0 must have required property 'entity'"));
        return true;
      });
    });

    it('should require frames to specify an entity version', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add change set:
        - effective: 2020-04-05T00:00:00.000Z
          frames:
          - entity: VAT Rate
            action: POST
            data:
            - type: standard
              rate: 0.10
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-frames-to-specify-an-entity-version.yaml: /add_change_set/0/frames/0 must have required property 'version'"));
        return true;
      });
    });

    it('should require frames to specify a valid action', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add change set:
        - effective: 2020-04-05T00:00:00.000Z
          frames:
          - entity: VAT Rate
            version: 1
            data:
            - type: standard
              rate: 0.10
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-frames-to-specify-a-valid-action.yaml: /add_change_set/0/frames/0 must have required property 'action'"));
        return true;
      });

      await rejects(() => applyYaml(t.name, `
        add change set:
        - effective: 2020-04-05T00:00:00.000Z
          frames:
          - entity: VAT Rate
            version: 1
            action: MEH
            data:
            - type: standard
              rate: 0.10
      `), (err) => {
        match(err.message, new RegExp('^001.should-require-frames-to-specify-a-valid-action.yaml: /add_change_set/0/frames/0/action must be equal to one of the allowed values: POST, DELETE'));
        return true;
      });
    });

    it('should require frame data to specify at least one value', async (t) => {
      await rejects(() => applyYaml(t.name, `
        add change set:
        - effective: 2020-04-05T00:00:00.000Z
          frames:
          - entity: VAT Rate
            version: 1
            action: POST
      `), (err) => {
        match(err.message, new RegExp("^001.should-require-frame-data-to-specify-at-least-one-value.yaml: /add_change_set/0/frames/0 must have required property 'data'"));
        return true;
      });

      await rejects(() => applyYaml(t.name, `
        add change set:
        - effective: 2020-04-05T00:00:00.000Z
          frames:
          - entity: VAT Rate
            version: 1
            action: POST
            data:
      `), (err) => {
        match(err.message, new RegExp('^001.should-require-frame-data-to-specify-at-least-one-value.yaml: /add_change_set/0/frames/0/data must be an array'));
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

        define entities:
        - name: VAT Rate
          version: 1
          fields:
          - name: type
            type: TEXT
          - name: rate
            type: NUMERIC
          identified by:
          - type

        add change set:
        - notes: 2020 VAT Rates
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

        - notes: 2021 VAT Rates
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

        - notes: 2022 VAT Rates
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

        define entities:
        - name: VAT Rate
          version: 1
          fields:
          - name: type
            type: TEXT
          - name: rate
            type: NUMERIC
          identified by:
          - type

        add change set:
        - notes: 2020 VAT Rates
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

        - notes: 2021 VAT Rates
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

        - notes: 2022 VAT Rates
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
  });

  describe('migrations', () => {
    it('supports YAML', async (t) => {
      await applyYaml(t.name, `
        define entities:
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
          "define_entities": [
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

    it('reports unsupported file types', async (t) => {
      await rejects(() => apply(t.name, 'UNSUPPORTED', 'yml'), (err) => {
        eq(err.message, 'Unsupported file type: 001.reports-unsupported-file-types.yml');
        return true;
      });
    });
  });

  describe('Hooks', () => {
    it('should add hooks', async (t) => {
      await applyYaml(t.name, `
        define entities:
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
