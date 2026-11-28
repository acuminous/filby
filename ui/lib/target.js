import { configure } from './config.js';
import { rewriteBasePath } from './server.js';

export function target(env) {
  const config = configure(env);
  if (config.missing) return undefined;
  return {
    target: config.target,
    rewrite: (path) => `${config.basePath}${path.slice('/api'.length)}`,
    configure: (proxy) => {
      proxy.on('proxyRes', (response) => {
        for (const name of ['location', 'link']) {
          const value = response.headers[name];
          if (typeof value === 'string') response.headers[name] = rewriteBasePath(value, config.basePath);
        }
      });
    },
  };
}
