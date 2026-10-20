const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { strictEqual: eq, ok, match, doesNotMatch } = require('node:assert');
const { describe, it } = require('node:test');
const marv = require('marv/api/promise');

const render = require('../lib/render-migration');

const run = promisify(execFile);
const filby = path.resolve('bin/filby.js');
const usage = /^Usage: filby <validate\|preview> \[directory \.\.\.\]$/m;

describe('CLI', () => {

  describe('validate', () => {

    it('exits 0 and prints nothing when every migration is valid', async () => {
      const { stdout, stderr } = await run(process.execPath, [filby, 'validate', 'examples/migrations']);
      eq(stdout, '');
      eq(stderr, '');
    });

    it('exits 1 and reports every invalid migration with its file and path', async () => {
      const { code, stdout, stderr } = await fails(['validate', 'test/cli']);
      eq(code, 1);
      eq(stdout, '');
      match(stderr, /^test\/cli\/002\.broken-schema\.yaml: \/0 must have required property 'name'$/m);
      match(stderr, /^test\/cli\/003\.broken-yaml\.yaml: Flow sequence in block collection must be sufficiently indented/m);
      doesNotMatch(stderr, /001\.valid\.yaml/);
    });

    it('defaults to the migrations directory', async () => {
      const { code, stderr } = await fails(['validate'], { cwd: path.resolve('test/cli/project') });
      eq(code, 1);
      match(stderr, /^migrations\/001\.broken\.yaml: \/0\/operation must be equal to one of the allowed values/m);
    });

    it('reports a directory that cannot be scanned', async () => {
      const { code, stderr } = await fails(['validate', 'examples/migrations', 'test/cli/missing']);
      eq(code, 1);
      match(stderr, /^test\/cli\/missing: ENOENT/m);
    });

    it('reports csv values that are not valid for the declared field type', async () => {
      const { code, stdout, stderr } = await fails(['validate', 'test/cli/numeric']);
      eq(code, 1);
      eq(stdout, '');
      eq(stderr, `test/cli/numeric/002.vat-rates.yaml: ${path.resolve('test/cli/numeric/vat-rates.csv')}:3 - value 'abc' for field 'rate' of entity 'VAT Rate v1' is not a valid NUMERIC\n`);
    });

    it('reports values that are not one of the enum values', async () => {
      const { code, stderr } = await fails(['validate', 'test/cli/enum']);
      eq(code, 1);
      eq(stderr, "test/cli/enum/002.seasons.yaml: /0/changes/0/data/1/type value 'Members' for field 'type' of entity 'season v1' is not one of the season_type values 'Owners' or 'Guests'\n");
    });

    it('reports data fields that the entity does not have', async () => {
      const { code, stderr } = await fails(['validate', 'test/cli/column']);
      eq(code, 1);
      eq(stderr, "test/cli/column/002.parks.yaml: /0/frames/0/data/0/nmae references a non existent field 'nmae' of entity 'park v1'\n");
    });

    it('accepts every form of value that postgres accepts', async () => {
      const { stdout, stderr } = await run(process.execPath, [filby, 'validate', 'test/cli/typed']);
      eq(stdout, '');
      eq(stderr, '');
    });
  });

  describe('preview', () => {

    it('prints the SQL the driver would run for every migration in order', async () => {
      const { stdout, stderr } = await run(process.execPath, [filby, 'preview', 'examples/migrations']);
      eq(stderr, '');
      const directory = path.resolve('examples/migrations');
      const scanned = await marv.scan(directory, { filter: /\.(ya?ml|json|sql)$/ });
      const expected = scanned
        .sort((a, b) => a.level - b.level)
        .map((migration) => `-- examples/migrations/${migration.filename}\n${render({ ...migration, directory })}\n`)
        .join('');
      eq(stdout, expected);
      ok(stdout.indexOf('-- examples/migrations/0001.define-park-schema.yaml') < stdout.indexOf('-- examples/migrations/0011.season-2024.yaml'));
    });

    it('prints SQL migrations verbatim', async () => {
      const { stdout } = await run(process.execPath, [filby, 'preview', 'examples/migrations']);
      ok(stdout.includes('CREATE FUNCTION get_park_v1(p_change_set_id INTEGER)'));
    });

    it('exits 1 and prints no SQL when any migration is invalid', async () => {
      const { code, stdout, stderr } = await fails(['preview', 'test/cli']);
      eq(code, 1);
      eq(stdout, '');
      match(stderr, /^test\/cli\/002\.broken-schema\.yaml: \/0 must have required property 'name'$/m);
      match(stderr, /^test\/cli\/003\.broken-yaml\.yaml: /m);
    });
  });

  it('prints usage for an unknown command', async () => {
    const { code, stderr } = await fails(['wombat']);
    eq(code, 1);
    match(stderr, usage);
  });

  it('prints usage when no command is given', async () => {
    const { code, stderr } = await fails([]);
    eq(code, 1);
    match(stderr, usage);
  });

  async function fails(args, options) {
    try {
      await run(process.execPath, [filby, ...args], options);
    } catch (err) {
      return err;
    }
    throw new Error('Expected the command to fail');
  }
});
