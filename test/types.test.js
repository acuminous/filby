const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { describe, it } = require('node:test');

const run = promisify(execFile);
const root = path.join(__dirname, '..');

describe('Types', () => {

  it('index.d.ts is the declarations generated from the JSDoc', async () => {
    await run(process.execPath, [path.join(root, 'scripts/types.js'), 'check']);
  });

  it('index.d.ts accepts every config option and public method', async () => {
    await run(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--module', 'commonjs', '--target', 'es2022', '--types', 'node', path.join(__dirname, 'types/usage.ts')]);
  });
});
