import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';

const PASSTHROUGH = ['Content-Type', 'ETag', 'Last-Modified', 'Cache-Control', 'X-Total-Count'];
const REWRITTEN = ['Location', 'Link'];

export function createApp({ target, basePath, dist }) {
  const app = new Hono();
  app.use((c, next) => (c.req.method === 'GET' ? next() : c.json({ error: `Method ${c.req.method} is not allowed` }, 405, { Allow: 'GET' })));
  app.get('/api/*', (c) => proxy(c, target, basePath));
  app.use(serveStatic({ root: dist }));
  app.get('*', serveStatic({ root: dist, path: 'index.html' }));
  return app;
}

export function rewriteBasePath(value, basePath) {
  return value.replace(new RegExp(`(^|<|://[^/<>]+)${escapeRegExp(basePath)}(?=[/?>]|$)`, 'g'), '$1/api');
}

async function proxy(c, target, basePath) {
  const url = new URL(c.req.url);
  const response = await fetch(`${target}${basePath}${url.pathname.slice('/api'.length)}${url.search}`, { headers: { Accept: 'application/json' }, redirect: 'manual' });
  const headers = new Headers();
  for (const name of PASSTHROUGH) {
    const value = response.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  for (const name of REWRITTEN) {
    const value = response.headers.get(name);
    if (value !== null) headers.set(name, rewriteBasePath(value, basePath));
  }
  return new Response(response.body, { status: response.status, headers });
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
