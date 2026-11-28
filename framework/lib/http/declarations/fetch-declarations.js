import { createFetch } from '../create-fetch.js';
import { ENTITY_REFERENCE, ERROR } from '../openapi.js';
import * as projections from './projections.js';
import * as entities from './entities.js';
import * as enums from './enums.js';
import * as hooks from './hooks.js';

export const fetchDeclarations = createFetch({
  resources: [projections, entities, enums, hooks],
  schemas: { EntityReference: ENTITY_REFERENCE, Error: ERROR },
  cacheControl: 'no-cache',
});
