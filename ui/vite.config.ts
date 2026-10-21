import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

import { target } from './lib/target.js';

export default defineConfig({
  plugins: [preact()],
  server: {
    proxy: {
      ...(target(process.env) ? { '/api': target(process.env) } : {}),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'client',
          environment: 'happy-dom',
          include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
          exclude: ['test/bin.test.ts'],
          setupFiles: ['test/setup.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'bin',
          environment: 'node',
          include: ['test/bin.test.ts'],
        },
      },
    ],
  },
});
