const { EOL } = require('os');
const path = require('path');
const fs = require('fs');
const { GraphNode, Harness, Suite, SpecReporter, syntax } = require('zunit');
const pkg = require(path.join(process.cwd(), 'package.json'));

import apiTests from './api.test'

const config = getConfig();

const suite = new Suite(config.name).add(apiTests);
const harness = new Harness(suite);

const interactive = String(process.env.CI).toLowerCase() !== 'true';
const reporter = new SpecReporter({ colours: interactive });

harness.run(reporter).then((report: typeof GraphNode) => {
  if (report.failed) process.exit(1);
  if (report.incomplete) {
    console.log(`One or more tests were not run!${EOL}`);
    process.exit(2);
  }
  if (config.exit) process.exit();
});

function getConfig() {
  return Object.assign({ name: pkg.name, require: [] }, loadConfigFromPackageJson(), loadConfigFromDefaultLocations(), loadConfigFromSpecifiedLocation(process.argv[2]));
}

function loadConfigFromSpecifiedLocation(configPath: string | undefined) {
  return configPath && require(path.resolve(configPath));
}

function loadConfigFromDefaultLocations() {
  return ['.zUnit.json', '.zUnit.js']
    .map((candidate) => {
      const configPath = path.resolve(candidate);
      return fs.existsSync(configPath) && require(configPath);
    })
    .find(Boolean);
}

function loadConfigFromPackageJson() {
  return pkg.zUnit;
}
