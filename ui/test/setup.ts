import { cleanup } from '@testing-library/preact';
import { afterEach, vi } from 'vitest';

import { openapi } from '../src/api';

process.env.TZ = 'UTC';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  openapi.value = undefined;
});
