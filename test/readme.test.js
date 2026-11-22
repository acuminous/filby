import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import YAML from 'yaml';

import validate from '../lib/validate-migration.js';

const readme = fs.readFileSync(path.join(import.meta.dirname, '..', 'README.md'), 'utf8');

const blocks = [...readme.matchAll(/^```yaml\n([\s\S]*?)^```$/gm)].map(({ index, 1: script }) => ({ line: readme.slice(0, index).split('\n').length, script }));

describe('README', () => {

  for (const { line, script } of blocks.filter(({ script }) => !script.includes('# filby:skip-validation'))) {
    it(`YAML example at line ${line} is a valid migration`, () => {
      validate(`README.md:${line}`, YAML.parse(script, { schema: 'core' }));
    });
  }
});
