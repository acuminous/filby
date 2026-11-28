import { handle, json } from './handler.js';
import { document } from './openapi.js';

const INFO = { title: 'Filby', version: '1.0.0' };

export function createFetch({ resources, schemas, cacheControl }) {
  const routes = resources.flatMap((resource) => resource.routes);
  const paths = Object.assign({}, ...resources.map((resource) => resource.paths));
  const components = Object.assign({ ...schemas }, ...resources.map((resource) => resource.schemas));
  const respond = (body) => json(200, body, { 'Cache-Control': cacheControl });

  return async (filby, request, { basePath = '', info = INFO } = {}, instance) => handle(request, basePath, (pathname, base) => {
    if (pathname === '/openapi.json') return async () => respond(document(base, info, paths, components));
    const route = routes.find(([pattern]) => pattern.test(pathname));
    return route && (async () => respond(await route[1](filby, pathname.match(route[0]), instance)));
  });
}
