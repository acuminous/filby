import { handle, json } from '../handler.js';
import { openapi } from './openapi.js';
import * as projections from './projections.js';
import * as changeLog from './change-log.js';
import * as documents from './documents.js';

const routes = [
  ...projections.routes,
  ...changeLog.routes,
  ...documents.routes,
];

export async function fetchProjections(filby, request, { basePath = '', info } = {}, loadDocuments) {
  return handle(request, basePath, (pathname, base) => {
    if (pathname === '/openapi.json') return async () => json(200, await openapi(filby, { basePath: base, info }));
    const route = routes.find(([pattern]) => pattern.test(pathname));
    return route && (async (url) => {
      const response = await route[1](filby, pathname.match(route[0]), url, loadDocuments);
      return isNotModified(request, response) ? notModified(response) : response;
    });
  });
}

function isNotModified(request, response) {
  const etag = response.headers.get('ETag');
  const condition = request.headers.get('If-None-Match');
  if (response.status !== 200 || etag === null || condition === null) return false;
  const tags = condition.split(',').map((tag) => tag.trim());
  return tags.includes('*') || tags.some((tag) => withoutWeakIndicator(tag) === withoutWeakIndicator(etag));
}

function withoutWeakIndicator(tag) {
  return tag.startsWith('W/') ? tag.slice(2) : tag;
}

function notModified(response) {
  const headers = ['ETag', 'Last-Modified', 'Cache-Control'].filter((name) => response.headers.has(name)).map((name) => [name, response.headers.get(name)]);
  return new Response(null, { status: 304, headers });
}
