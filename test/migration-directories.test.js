const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { deepEqual: deq } = require('node:assert');
const { describe, it, before, beforeEach, after } = require('node:test');

const { Filby } = require('..');
const TestFilby = require('./TestFilby');

const database = { user: 'fby_test', password: 'fby_test' };

describe('Migration Directories', () => {

  let filby;
  const directories = [];

  before(async () => {
    filby = new TestFilby({
      nukeCustomObjects: async (tx) => {
        await tx.query('DROP TABLE IF EXISTS yml_v1');
        await tx.query('DROP FUNCTION IF EXISTS get_yml_v1_aggregate');
      },
    });
    await filby.reset();
  });

  beforeEach(async () => {
    await filby.wipe();
  });

  after(async () => {
    await filby.stop();
    await Promise.all(directories.map((directory) => fs.rm(directory, { recursive: true, force: true })));
  });

  it('should default to ./migrations', async () => {
    const root = await createDirectory({});
    await writeFiles(path.join(root, 'migrations'), {
      '.marvrc': marvrc(),
      '001.add-default.sql': addEntity('Default'),
    });

    const cwd = process.cwd();
    process.chdir(root);
    try {
      await withFilby({ database }, (instance) => instance.init());
    } finally {
      process.chdir(cwd);
    }

    deq(await getEntityNames(), ['Default']);
  });

  it('should not apply Filby migrations twice when ./migrations is the Filby directory', async () => {
    await withFilby({ database }, (instance) => instance.init());
  });

  it('should load directories sharing the default namespace in level order', async () => {
    const first = await createDirectory({
      '.marvrc': marvrc(),
      '002.add-second.sql': addEntity('Second'),
    });
    const second = await createDirectory({
      '.marvrc': marvrc(),
      '001.add-first.sql': addEntity('First'),
    });

    await withFilby({ database, migrations: [first, second] }, (instance) => instance.init());

    deq(await getEntityNames(), ['First', 'Second']);
  });

  it('should load namespaced directories with overlapping levels', async () => {
    const alpha = await createDirectory({
      '.marvrc': marvrc('alpha'),
      '001.add-alpha.sql': addEntity('Alpha'),
    });
    const beta = await createDirectory({
      '.marvrc': marvrc('beta'),
      '001.add-beta.sql': addEntity('Beta'),
    });

    await withFilby({ database, migrations: [alpha, beta] }, (instance) => instance.init());

    deq(await getEntityNames(), ['Alpha', 'Beta']);
  });

  it('should apply .yml migrations and ignore files with other extensions', async () => {
    const directory = await createDirectory({
      '.marvrc': marvrc(),
      '0001.notes.yamlx': 'not a migration',
      'README.md': '# Not a migration',
      '001.add-yml.yml': [
        '- operation: ADD_ENTITY',
        '  name: Yml',
        '  version: 1',
        '  fields:',
        '    - name: type',
        '      type: TEXT',
        '  identified_by:',
        '    - type',
      ].join('\n'),
    });

    await withFilby({ database, migrations: [directory] }, (instance) => instance.init());

    deq(await getEntityNames(), ['Yml']);
  });

  async function createDirectory(files) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'filby-'));
    directories.push(directory);
    await writeFiles(directory, files);
    return directory;
  }

  async function withFilby(config, fn) {
    const instance = new Filby(config);
    try {
      await fn(instance);
    } finally {
      await instance.stop();
    }
  }

  async function getEntityNames() {
    const { rows } = await filby.withTransaction((tx) => tx.query('SELECT name FROM fby_entity ORDER BY id'));
    return rows.map(({ name }) => name);
  }
});

async function writeFiles(directory, files) {
  await fs.mkdir(directory, { recursive: true });
  await Promise.all(Object.entries(files).map(([filename, content]) => fs.writeFile(path.join(directory, filename), content)));
}

function marvrc(namespace) {
  return JSON.stringify({ namespace, directives: { audit: false } });
}

function addEntity(name) {
  return `INSERT INTO fby_entity (name, version) VALUES ('${name}', 1);`;
}
