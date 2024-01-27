import { Projection } from '../../..';

export type ProjectionApiEntry = {
  routes: string[];
  index: string;
}

export default class ProjectionsApi {

  #apis = new Map<string, ProjectionApiEntry>();

  update({ projection, index, method, path }: { projection: Projection, index: boolean; method: string, path: string }) {
    if (method !== 'GET' || !projection) return;
    this.#upsertApiEntry(projection, index, path);
  }

  get(projection: Projection) {
    return this.#apis.get(projection.key);
  }

  #upsertApiEntry(projection: Projection, index: boolean, path: string) {
    const entry = this.#ensureApiEntry(projection);
    if (index) entry.index = path;
    entry.routes.push(path);
  }

  #ensureApiEntry(projection: Projection): ProjectionApiEntry {
    return this.#apis.get(projection.key) || this.#createApiEntry(projection.key);
  }

  #createApiEntry(key: string): ProjectionApiEntry {
    const entry = { routes: [], index: '' };
    this.#apis.set(key, entry);
    return entry;
  }
};
