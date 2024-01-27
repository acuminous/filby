module.exports = class ProjectionsApi {

  #apis = new Map();

  update({ projection, index, method, path }) {
    if (method !== 'GET' || !projection) return;
    this.#upsertApiEntry(projection, index, path);
  }

  get(projection) {
    return this.#apis.get(projection.key);
  }

  #upsertApiEntry(projection, index, path) {
    const entry = this.#ensureApiEntry(projection);
    if (index) entry.index = path;
    entry.routes.push(path);
  }

  #ensureApiEntry(projection) {
    return this.#apis.get(projection.key) || this.#createApiEntry(projection.key);
  }

  #createApiEntry(key) {
    const entry = { routes: [], index: '' };
    this.#apis.set(key, entry);
    return entry;
  }
};
