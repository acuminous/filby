const fs = require('node:fs');
const path = require('node:path');
const { describe, it } = require('node:test');
const YAML = require('yaml');

const validate = require('../lib/validate-migration');

const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

const blocks = [...readme.matchAll(/^```yaml\n([\s\S]*?)^```$/gm)].map(({ index, 1: script }) => ({ line: readme.slice(0, index).split('\n').length, script }));

describe('README', () => {

  for (const { line, script } of blocks.filter(({ script }) => !script.includes('# filby:skip-validation'))) {
    it(`YAML example at line ${line} is a valid migration`, () => {
      validate(`README.md:${line}`, YAML.parse(script, { schema: 'core' }));
    });
  }
});
