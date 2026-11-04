const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { strictEqual: eq, deepStrictEqual: deq, ok, match, throws, notStrictEqual: neq } = require('node:assert');
const { describe, it, before, after } = require('node:test');

const runtime = require('../lib/bundle-runtime');
const { pack } = require('../lib/pack');

const run = promisify(execFile);
const cli = path.resolve('bin/filby.js');
const fixture = path.resolve('test/pack/parks-v1.json');
const usage = /^Usage: filby <validate\|preview> \[directory \.\.\.\]$/m;

describe('Pack', () => {

  let directory;

  before(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'filby-pack-'));
  });

  after(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  it('writes a package named after the projection and versioned by module API and latest change set', async () => {
    const out = path.join(directory, 'versioned');
    const { stdout } = await run(process.execPath, [cli, 'pack', '--bundle', fixture, '--scope', '@example', '--out', out]);

    eq(stdout, '@example/projection-parks-v1@1.7.0\n');
    const manifest = JSON.parse(fs.readFileSync(path.join(out, 'package.json'), 'utf8'));
    deq(manifest, { name: '@example/projection-parks-v1', version: '1.7.0', description: 'Parks with their seasons and operator', main: 'index.js', types: 'index.d.ts' });
    deq(JSON.parse(fs.readFileSync(path.join(out, 'bundle.json'), 'utf8')), loadBundle());
  });

  it('names a package without a scope', async () => {
    const { stdout } = await run(process.execPath, [cli, 'pack', '--bundle', fixture, '--out', path.join(directory, 'unscoped')]);
    eq(stdout, 'projection-parks-v1@1.7.0\n');
  });

  it('uses the given package name', async () => {
    const { stdout } = await run(process.execPath, [cli, 'pack', '--bundle', fixture, '--name', '@example/parks', '--out', path.join(directory, 'named')]);
    eq(stdout, '@example/parks@1.7.0\n');
  });

  it('converts the projection name and version into the package name', () => {
    const bundle = { ...loadBundle(), name: ' VAT Rates (UK) ', version: 2 };
    const { name, version } = pack(bundle, { scope: '@example', out: path.join(directory, 'converted') });
    eq(name, '@example/projection-vat-rates-uk-v2');
    eq(version, '1.7.0');
  });

  it('sets the patch version', async () => {
    const { stdout } = await run(process.execPath, [cli, 'pack', '--bundle', fixture, '--patch', '3', '--out', path.join(directory, 'patched')]);
    eq(stdout, 'projection-parks-v1@1.7.3\n');
  });

  it('bumps the minor version when a later bundle has a new change set', () => {
    const bundle = loadBundle();
    const first = pack(bundle, { out: path.join(directory, 'first') });
    bundle.changeSets.push({ id: 9, effective: '2100-01-01T00:00:00.000Z', description: '2100 Parks', lastModified: '2026-10-02T09:00:00.000Z', entityTag: 'a4' });
    bundle.documents[9] = [];
    const second = pack(bundle, { out: path.join(directory, 'second') });

    eq(first.version, '1.7.0');
    eq(second.version, '1.9.0');
    const [, firstMinor] = first.version.split('.').map(Number);
    const [, secondMinor] = second.version.split('.').map(Number);
    ok(secondMinor > firstMinor);
  });

  it('produces a package that installs and resolves change sets by effective date', async () => {
    const consumer = await installPackage('installed');
    const parks = createRequire(path.join(consumer, 'index.js'))('@example/projection-parks-v1');

    eq(parks.asOf(new Date('2020-06-01T00:00:00Z')).id, 3);
    eq(parks.asOf(new Date('2099-06-01T00:00:00Z')).id, 7);
    eq(parks.asOf(new Date('2019-06-01T00:00:00Z')), undefined);
    deq(parks.getCurrentDocuments('2020-06-01T00:00:00Z').map(({ code }) => code), ['DC', 'GA']);
    deq(parks.getCurrentDocuments().map(({ code }) => code), ['DC']);
    ok(parks.getDocuments(3)[0].opened instanceof Date);
  });

  it('generates type declarations that compile and type documents', async () => {
    const consumer = await installPackage('typed');
    fs.writeFileSync(path.join(consumer, 'tsconfig.json'), JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, module: 'commonjs', moduleResolution: 'node', target: 'es2022', lib: ['es2022'], types: [] },
      files: ['consumer.ts'],
    }));
    fs.writeFileSync(path.join(consumer, 'consumer.ts'), [
      "import { asOf, getDocuments, getCurrentDocuments, changeSets, name, ProjectionDocument } from '@example/projection-parks-v1';",
      'const documents: ProjectionDocument[] = getDocuments(3);',
      'const opened: Date | null = documents[0].opened;',
      'const start: Date = documents[0].seasons[0].start;',
      'const operator: string | undefined = documents[0].operator?.name;',
      "const status: 'OPEN' | 'CLOSED' | null = documents[0].status;",
      'const facts: unknown = documents[0].facts;',
      'const effective: Date | undefined = asOf(new Date())?.effective;',
      "const projection: 'Parks' = name;",
      '// @ts-expect-error',
      'documents[0].wombat;',
      '// @ts-expect-error',
      "getDocuments('3');",
      "getCurrentDocuments('2020-06-01');",
      'export { opened, start, operator, status, facts, effective, projection, changeSets };',
      '',
    ].join('\n'));
    const tsc = require.resolve('typescript/bin/tsc', { paths: [path.resolve('examples/holiday-park')] });

    const { stdout } = await run(process.execPath, [tsc, '-p', consumer]).catch((err) => {
      throw new Error(err.stdout);
    });
    eq(stdout, '');
  });

  it('rejects a bundle with an unsupported format', async () => {
    const file = writeBundle('future.json', { ...loadBundle(), format: 2 });
    const { code, stderr } = await packFails(file);
    eq(code, 1);
    match(stderr, /^Unsupported bundle format 2; supported formats are 1$/m);
  });

  it('rejects a bundle that does not match the bundle format', async () => {
    const { changeSets, ...bundle } = loadBundle();
    const { code, stderr } = await packFails(writeBundle('invalid.json', bundle));
    eq(code, 1);
    match(stderr, /^Invalid bundle$/m);
    match(stderr, /^\/ must have required property 'changeSets'$/m);
  });

  it('rejects an unreadable bundle', async () => {
    const { code, stderr } = await packFails(path.join(directory, 'missing.json'));
    eq(code, 1);
    match(stderr, /^Cannot read bundle '.*missing\.json': ENOENT/m);
  });

  it('rejects both a scope and a name', async () => {
    const { code, stderr } = await fails(['pack', '--bundle', fixture, '--scope', '@example', '--name', 'parks', '--out', path.join(directory, 'both')]);
    eq(code, 1);
    match(stderr, /^Give either '--scope' or '--name', not both$/m);
    match(stderr, usage);
  });

  it('rejects an invalid scope', async () => {
    const { code, stderr } = await fails(['pack', '--bundle', fixture, '--scope', 'example', '--out', path.join(directory, 'scope')]);
    eq(code, 1);
    match(stderr, /^Scope 'example' is not a valid npm scope$/m);
  });

  it('rejects an invalid patch', async () => {
    const { code, stderr } = await fails(['pack', '--bundle', fixture, '--patch', '1.5', '--out', path.join(directory, 'patch')]);
    eq(code, 1);
    match(stderr, /^Patch '1\.5' must be a whole number$/m);
    match(stderr, usage);
  });

  it('rejects a projection name with nothing to use in a package name', () => {
    throws(() => pack({ ...loadBundle(), name: '£$%' }, { out: path.join(directory, 'unnamed') }), { message: "Projection '£$%' has no characters that can be used in a package name; give one with --name" });
  });

  for (const missing of ['bundle', 'out']) {
    it(`rejects a missing --${missing}`, async () => {
      const args = { bundle: fixture, out: path.join(directory, 'missing') };
      delete args[missing];
      const { code, stderr } = await fails(['pack', ...Object.entries(args).flatMap(([name, value]) => [`--${name}`, value])]);
      eq(code, 1);
      match(stderr, new RegExp(`^Missing option '--${missing}'$`, 'm'));
      match(stderr, usage);
    });
  }

  describe('runtime', () => {

    it('resolves the change set in force by latest effective date, then highest id', () => {
      const bundle = loadBundle();
      bundle.changeSets.push({ id: 4, effective: '2020-01-01T00:00:00.000Z', description: 'Reissued 2020 Parks', lastModified: '2026-10-01T09:00:00.000Z', entityTag: 'a5' });
      bundle.documents[4] = [];
      const parks = runtime(bundle);

      eq(parks.asOf('2020-01-01T00:00:00.000Z').id, 4);
      eq(parks.asOf('2019-12-31T23:59:59.999Z'), undefined);
      eq(parks.asOf(Date.parse('2021-01-01T00:00:00.000Z')).id, 5);
    });

    it('rejects an unknown change set', () => {
      const parks = runtime(loadBundle());
      throws(() => parks.getDocuments(4), { message: 'Change set 4 does not exist' });
    });

    it('rejects an invalid instant', () => {
      const parks = runtime(loadBundle());
      throws(() => parks.asOf('wombat'), { message: "Invalid instant 'wombat'" });
    });

    it('rejects current documents when no change set is in force', () => {
      const parks = runtime(loadBundle());
      throws(() => parks.getCurrentDocuments(new Date('2019-01-01T00:00:00Z')), { message: "Projection 'Parks v1' has no change set in force at 2019-01-01T00:00:00.000Z" });
    });

    it('returns documents that callers may change without affecting later reads', () => {
      const parks = runtime(loadBundle());
      const [first] = parks.getDocuments(3);
      first.facts.pools = 99;
      first.seasons.push({});
      const [second] = parks.getDocuments(3);
      neq(second, first);
      eq(second.facts.pools, 2);
      eq(second.seasons.length, 1);
    });
  });

  async function installPackage(name) {
    const root = path.join(directory, name);
    const out = path.join(root, 'package');
    const consumer = path.join(root, 'consumer');
    fs.mkdirSync(consumer, { recursive: true });
    await run(process.execPath, [cli, 'pack', '--bundle', fixture, '--scope', '@example', '--out', out]);
    const { stdout } = await run('npm', ['pack', '--silent', '--pack-destination', root], { cwd: out });
    fs.writeFileSync(path.join(consumer, 'package.json'), JSON.stringify({ name: 'consumer', private: true }));
    await run('npm', ['install', '--offline', '--no-audit', '--no-fund', '--silent', path.join(root, stdout.trim())], { cwd: consumer });
    ok(fs.existsSync(path.join(consumer, 'node_modules', '@example', 'projection-parks-v1', 'index.d.ts')));
    return consumer;
  }

  function writeBundle(filename, bundle) {
    const file = path.join(directory, filename);
    fs.writeFileSync(file, JSON.stringify(bundle));
    return file;
  }

  async function packFails(bundle) {
    return fails(['pack', '--bundle', bundle, '--out', path.join(directory, 'rejected')]);
  }

  async function fails(args) {
    try {
      await run(process.execPath, [cli, ...args]);
    } catch (err) {
      return err;
    }
    throw new Error('Expected the command to fail');
  }
});

function loadBundle() {
  return JSON.parse(fs.readFileSync(fixture, 'utf8'));
}
