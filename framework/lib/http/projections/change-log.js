import { HttpError, findProjection, getInteger, json } from '../handler.js';

const routes = [
  [/^\/changelog$/, getChangeLog],
];

async function getChangeLog(filby, _, url) {
  const name = url.searchParams.get('projection');
  if (name === null) throw new HttpError(400, "Missing query parameter 'projection'");
  const version = getInteger(url, 'version');
  const since = url.searchParams.has('since') ? getInteger(url, 'since') : undefined;
  const projection = await filby.withTransaction((tx) => findProjection(tx, name, version));
  const changeLog = await filby.getChangeLog(projection, { since });
  const latest = changeLog[changeLog.length - 1];
  return json(200, changeLog, { ...(latest && { ETag: `"${latest.entityTag}"`, 'Last-Modified': latest.lastModified.toUTCString() }), 'Cache-Control': 'no-cache' });
}

export { routes };
