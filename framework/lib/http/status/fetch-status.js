import { createFetch } from '../create-fetch.js';
import { PROJECTION_REFERENCE, ERROR } from '../openapi.js';
import * as hooks from './hooks.js';

export const fetchStatus = createFetch({
  resources: [hooks],
  schemas: { ProjectionReference: PROJECTION_REFERENCE, Error: ERROR },
  cacheControl: 'no-store',
});
