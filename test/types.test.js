import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, it } from 'node:test';

const run = promisify(execFile);
const root = path.join(import.meta.dirname, '..');
const tsc = fileURLToPath(import.meta.resolve('typescript/bin/tsc'));
const usage = path.join(import.meta.dirname, 'types/usage.ts');

describe('Types', () => {

  it('index.d.ts is the declarations generated from the JSDoc', async () => {
    await run(process.execPath, [path.join(root, 'scripts/types.js'), 'check']);
  });

  it('index.d.ts accepts every config option and public method from an ES module', async () => {
    await run(process.execPath, [tsc, '--noEmit', '--strict', '--skipLibCheck', '--module', 'nodenext', '--target', 'es2022', '--types', 'node', usage]);
  });

  it('index.d.ts accepts every config option and public method from a CommonJS module', async () => {
    await run(process.execPath, [tsc, '--noEmit', '--strict', '--skipLibCheck', '--module', 'commonjs', '--target', 'es2022', '--types', 'node', usage]);
  });

});
