const REQUIRED = ['FILBY_API_HOST', 'FILBY_API_PORT'];

export function configure(env) {
  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length) return { missing };
  const protocol = env.FILBY_API_PROTOCOL || 'http';
  const basePath = (env.FILBY_API_PATH ?? '/api').replace(/\/+$/, '');
  return { target: `${protocol}://${env.FILBY_API_HOST}:${env.FILBY_API_PORT}`, basePath, port: Number(env.PORT || 4000) };
}

export function usage() {
  return 'filby-ui serves a read-only UI for a Filby API. Set FILBY_API_HOST and FILBY_API_PORT to the host and port of the application that mounts filby.fetch, FILBY_API_PATH to the base path it is mounted under (default /api), FILBY_API_PROTOCOL to http or https (default http) and PORT to the port the UI should listen on (default 4000). For example: FILBY_API_HOST=localhost FILBY_API_PORT=3000 npx github:acuminous/filby-ui';
}
