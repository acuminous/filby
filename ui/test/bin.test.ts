import { spawn } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { configure } from '../lib/config.js';
import { createApp, rewriteBasePath } from '../lib/server.js';

type Server = ReturnType<typeof serve>;

const BIN = path.resolve('bin/filby-ui.js');
const DIST = path.resolve('test/fixtures/dist');

describe('config', () => {
  it('requires the host and port', () => {
    expect(configure({})).toEqual({ missing: ['FILBY_API_HOST', 'FILBY_API_PORT'] });
    expect(configure({ FILBY_API_HOST: 'localhost' })).toEqual({ missing: ['FILBY_API_PORT'] });
  });

  it('defaults the path, protocol and port', () => {
    expect(configure({ FILBY_API_HOST: 'localhost', FILBY_API_PORT: '3000' })).toEqual({ target: 'http://localhost:3000', basePath: '/api', port: 4000 });
  });

  it('honours the path, protocol and port', () => {
    const env = { FILBY_API_HOST: 'example.com', FILBY_API_PORT: '443', FILBY_API_PATH: '/reference/', FILBY_API_PROTOCOL: 'https', PORT: '8080' };
    expect(configure(env)).toEqual({ target: 'https://example.com:443', basePath: '/reference', port: 8080 });
  });

  it('treats an empty path as the root', () => {
    expect(configure({ FILBY_API_HOST: 'localhost', FILBY_API_PORT: '3000', FILBY_API_PATH: '' })).toEqual({ target: 'http://localhost:3000', basePath: '', port: 4000 });
  });
});

describe('rewriteBasePath', () => {
  it('rewrites a location', () => {
    expect(rewriteBasePath('/reference/projections/Parks/v1?changeSetId=3', '/reference')).toBe('/api/projections/Parks/v1?changeSetId=3');
  });

  it('rewrites every link', () => {
    const link = '</reference/projections/Parks/v1?changeSetId=3&page=1>; rel="prev", </reference/projections/Parks/v1?changeSetId=3&page=3>; rel="next"';
    expect(rewriteBasePath(link, '/reference')).toBe('</api/projections/Parks/v1?changeSetId=3&page=1>; rel="prev", </api/projections/Parks/v1?changeSetId=3&page=3>; rel="next"');
  });

  it('rewrites an absolute location', () => {
    expect(rewriteBasePath('http://localhost:3000/reference/projections/Parks/v1', '/reference')).toBe('http://localhost:3000/api/projections/Parks/v1');
  });

  it('prefixes a root base path', () => {
    expect(rewriteBasePath('</projections/Parks/v1?page=2>; rel="next"', '')).toBe('</api/projections/Parks/v1?page=2>; rel="next"');
  });

  it('leaves other paths alone', () => {
    expect(rewriteBasePath('/references/projections', '/reference')).toBe('/references/projections');
  });
});

describe('proxy', () => {
  let upstream: Server;
  let proxy: Server;
  let base: string;

  beforeAll(async () => {
    const stub = new Hono();
    stub.get('/reference/echo', (c) => c.json({ url: c.req.url, accept: c.req.header('Accept') }, 200, { 'X-Total-Count': '7', ETag: 'abc', 'Last-Modified': 'Mon, 01 Jan 2024 00:00:00 GMT', 'Cache-Control': 'max-age=31536000, immutable', 'X-Secret': 'hidden' }));
    stub.get('/reference/projections/Parks/v1', (c) => {
      if (!c.req.query('changeSetId')) return c.body(null, 307, { Location: '/reference/projections/Parks/v1?changeSetId=3' });
      return c.json([{ code: 'DC' }], 200, { Link: '</reference/projections/Parks/v1?changeSetId=3&page=1>; rel="prev", </reference/projections/Parks/v1?changeSetId=3&page=3>; rel="next"' });
    });
    stub.get('/reference/missing', (c) => c.json({ error: 'No route for /reference/missing' }, 404));
    upstream = serve({ fetch: stub.fetch, port: 0 });
    const target = `http://localhost:${await port(upstream)}`;
    proxy = serve({ fetch: createApp({ target, basePath: '/reference', dist: DIST }).fetch, port: 0 });
    base = `http://localhost:${await port(proxy)}`;
  });

  afterAll(async () => {
    await Promise.all([close(proxy), close(upstream)]);
  });

  it('forwards the path and query string', async () => {
    const response = await fetch(`${base}/api/echo?types=a&types=b&code=D%20C`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toMatch(/\/reference\/echo\?types=a&types=b&code=D%20C$/);
    expect(body.accept).toBe('application/json');
  });

  it('passes through the listed headers only', async () => {
    const response = await fetch(`${base}/api/echo`);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('X-Total-Count')).toBe('7');
    expect(response.headers.get('ETag')).toBe('abc');
    expect(response.headers.get('Last-Modified')).toBe('Mon, 01 Jan 2024 00:00:00 GMT');
    expect(response.headers.get('Cache-Control')).toBe('max-age=31536000, immutable');
    expect(response.headers.get('X-Secret')).toBeNull();
  });

  it('rewrites the base path in a redirect without following it', async () => {
    const response = await fetch(`${base}/api/projections/Parks/v1`, { redirect: 'manual' });
    expect(response.status).toBe(307);
    expect(response.headers.get('Location')).toBe('/api/projections/Parks/v1?changeSetId=3');
  });

  it('rewrites the base path in paging links', async () => {
    const response = await fetch(`${base}/api/projections/Parks/v1?changeSetId=3`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Link')).toBe('</api/projections/Parks/v1?changeSetId=3&page=1>; rel="prev", </api/projections/Parks/v1?changeSetId=3&page=3>; rel="next"');
    expect(await response.json()).toEqual([{ code: 'DC' }]);
  });

  it('passes through errors', async () => {
    const response = await fetch(`${base}/api/missing`);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'No route for /reference/missing' });
  });

  it('refuses anything but GET', async () => {
    for (const url of [`${base}/api/echo`, `${base}/`]) {
      const response = await fetch(url, { method: 'POST' });
      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('GET');
      expect(await response.json()).toEqual({ error: 'Method POST is not allowed' });
    }
  });

  it('serves the bundle', async () => {
    const response = await fetch(`${base}/assets/app.js`);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toMatch(/javascript/);
    expect(await response.text()).toBe('console.log(1);\n');
  });

  it('falls back to the page for any other path', async () => {
    for (const url of [`${base}/`, `${base}/projections/Parks/v1/change-sets/3?code=DC`]) {
      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toMatch(/text\/html/);
      expect(await response.text()).toContain('<div id="app">');
    }
  });
});

describe('bin', () => {
  it('prints usage and exits when the target is not configured', async () => {
    const child = spawn(process.execPath, [BIN], { env: { PATH: process.env.PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
    const stderr = collect(child.stderr);
    const [code] = await once(child, 'exit');
    expect(code).toBe(1);
    expect(await stderr).toMatch(/FILBY_API_HOST/);
    expect(await stderr).toMatch(/FILBY_API_PORT/);
  });

  it('announces where it is listening and what it proxies', async () => {
    const env = { PATH: process.env.PATH, FILBY_API_HOST: 'localhost', FILBY_API_PORT: '3999', PORT: '0' };
    const child = spawn(process.execPath, [BIN], { env, cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const line = await firstLine(child.stdout);
      const match = line.match(/^filby-ui listening on http:\/\/localhost:(\d+), proxying \/api to http:\/\/localhost:3999\/api$/);
      expect(match, line).not.toBeNull();
      const response = await fetch(`http://localhost:${match?.[1]}/projections/Parks/v1`);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain('<div id="app">');
    } finally {
      child.kill();
      await once(child, 'exit');
    }
  });
});

async function port(server: Server) {
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Not listening on a port');
  return address.port;
}

function close(server: Server) {
  return new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

async function collect(stream: NodeJS.ReadableStream) {
  let text = '';
  for await (const chunk of stream) text += chunk;
  return text;
}

async function firstLine(stream: NodeJS.ReadableStream) {
  let text = '';
  for await (const chunk of stream) {
    text += chunk;
    if (text.includes('\n')) break;
  }
  return text.split('\n')[0] ?? '';
}
