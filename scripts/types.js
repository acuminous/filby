import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { rollup } from 'rollup';
import { dts } from 'rollup-plugin-dts';

const root = path.join(import.meta.dirname, '..');
const target = path.join(root, 'index.d.ts');

const commands = { build, check };

const [command = 'build'] = process.argv.slice(2);
if (!commands[command]) fail(`Usage: node scripts/types.js ${Object.keys(commands).join('|')}`);

commands[command]().catch((err) => fail(err.message));

async function build() {
  fs.writeFileSync(target, await generate());
}

async function check() {
  if (fs.readFileSync(target, 'utf8') !== (await generate())) fail('index.d.ts differs from the declarations generated from the JSDoc. Run npm run types and commit the result.');
}

async function generate() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'filby-types-'));
  try {
    execFileSync(fileURLToPath(import.meta.resolve('typescript/bin/tsc')), ['--allowJs', '--declaration', '--removeComments', '--emitDeclarationOnly', '--skipLibCheck', '--module', 'nodenext', '--target', 'es2022', '--types', 'node', '--outDir', outDir, path.join(root, 'index.js')], { stdio: 'inherit' });
    const bundle = await rollup({ input: path.join(outDir, 'index.d.ts'), external: ['pg'], plugins: [dts({ respectExternal: true })] });
    const { output: [{ code }] } = await bundle.generate({ format: 'es' });
    return code;
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
