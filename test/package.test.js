const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { deepStrictEqual: deq } = require('node:assert');
const { describe, it, before } = require('node:test');

const root = path.join(__dirname, '..');

const UNPUBLISHED = ['.github', '.gitignore', '_config.yml', 'biome.json', 'CLAUDE.md', 'codecov.yml', 'docker-compose.yaml', 'examples', 'lefthook.yml', 'package-lock.json', 'scripts', 'test'];

const topLevel = (files) => [...new Set(files.map((file) => file.split('/')[0]))].sort();

describe('Package', () => {
  let packed;
  let tracked;

  before(() => {
    const stdout = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--foreground-scripts=false'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const [pack] = Object.values(JSON.parse(stdout));
    packed = pack.files.map((file) => file.path).sort();
    tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean).sort();
  });

  it('should publish only the runtime files', () => {
    deq(topLevel(packed), ['bin', 'CHANGELOG.md', 'index.d.ts', 'index.js', 'lib', 'LICENSE.txt', 'migrations', 'package.json', 'README.md'].sort());
  });

  it('should publish every tracked file that is not explicitly unpublished', () => {
    deq(
      topLevel(packed),
      topLevel(tracked).filter((entry) => !UNPUBLISHED.includes(entry)),
    );
  });

  it('should publish exactly the tracked files in the runtime directories', () => {
    for (const directory of ['bin', 'lib', 'migrations']) {
      const prefix = `${directory}/`;
      deq(
        packed.filter((file) => file.startsWith(prefix)),
        tracked.filter((file) => file.startsWith(prefix)),
      );
    }
  });
});
