#!/usr/bin/env node
import { serve } from '@hono/node-server';

import { configure, usage } from '../lib/config.js';
import { createApp } from '../lib/server.js';

const dist = new URL('../dist', import.meta.url).pathname;
const config = configure(process.env);

if (config.missing) {
  console.error(`${usage()}\n\nMissing: ${config.missing.join(', ')}`);
  process.exit(1);
}

const { target, basePath, port } = config;

serve({ fetch: createApp({ target, basePath, dist }).fetch, port }, (info) => {
  console.log(`filby-ui listening on http://localhost:${info.port}, proxying /api to ${target}${basePath}`);
});
