import { describe, expect, it, vi } from 'vitest';

import { ApiError, getChangeLog, getDocuments, getOpenApi, getProjections, openapi, parseLink } from '../src/api';
import { changeSet, openapi as openapiDocument, park, projection, stubApi } from './fixtures';

describe('api', () => {
  it('lists the projections', async () => {
    const requests = stubApi({ '/api/projections': { body: [projection()] } });
    expect(await getProjections()).toEqual([projection()]);
    expect(requests.map(String)).toEqual(['http://localhost/api/projections']);
  });

  it('fetches the OpenAPI document once and holds it in a signal', async () => {
    const requests = stubApi({ '/api/openapi.json': { body: openapiDocument() } });
    expect(await getOpenApi()).toEqual(openapiDocument());
    expect(await getOpenApi()).toEqual(openapiDocument());
    expect(requests).toHaveLength(1);
    expect(openapi.value).toEqual(openapiDocument());
  });

  it('fetches the change log of a projection', async () => {
    const requests = stubApi({ '/api/changelog': { body: [changeSet()] } });
    expect(await getChangeLog('VAT Rates', 2)).toEqual([changeSet()]);
    expect(requests.map(String)).toEqual(['http://localhost/api/changelog?projection=VAT+Rates&version=2']);
  });

  it('fetches a page of documents with its total and links', async () => {
    const headers = { 'X-Total-Count': '5', Link: '</api/projections/VAT%20Rates/v1?changeSetId=3&page=1>; rel="prev", </api/projections/VAT%20Rates/v1?changeSetId=3&page=3>; rel="next"' };
    const requests = stubApi({ '/api/projections/VAT%20Rates/v1': { body: [park()], headers } });
    const query = new URLSearchParams([['types', 'a'], ['types', 'b'], ['page', '2']]);
    expect(await getDocuments('VAT Rates', 1, 3, query)).toEqual({
      documents: [park()],
      total: 5,
      prev: '/api/projections/VAT%20Rates/v1?changeSetId=3&page=1',
      next: '/api/projections/VAT%20Rates/v1?changeSetId=3&page=3',
    });
    expect(requests.map(String)).toEqual(['http://localhost/api/projections/VAT%20Rates/v1?types=a&types=b&page=2&changeSetId=3']);
  });

  it('falls back to the document count when there is no total', async () => {
    stubApi({ '/api/projections/Parks/v1': { body: [park(), park({ code: 'PV' })] } });
    expect(await getDocuments('Parks', 1, 3, new URLSearchParams())).toEqual({ documents: [park(), park({ code: 'PV' })], total: 2 });
  });

  it('throws the API error message and status', async () => {
    stubApi({ '/api/changelog': { status: 404, body: { error: "Projection 'Parks v9' does not exist" } } });
    const error = await getChangeLog('Parks', 9).catch((err) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(404);
    expect(error.message).toBe("Projection 'Parks v9' does not exist");
  });

  it('describes an error without a JSON body', async () => {
    vi.stubGlobal('fetch', async () => new Response('Bad Gateway', { status: 502, statusText: 'Bad Gateway' }));
    const error = await getProjections().catch((err) => err);
    expect(error.status).toBe(502);
    expect(error.message).toBe('Bad Gateway');
  });
});

describe('parseLink', () => {
  it('parses the relations', () => {
    expect(parseLink('</a?page=1>; rel="prev", </a?page=3>; rel="next"')).toEqual({ prev: '/a?page=1', next: '/a?page=3' });
  });

  it('parses a single relation', () => {
    expect(parseLink('</a?page=2>; rel="next"')).toEqual({ next: '/a?page=2' });
  });

  it('parses nothing', () => {
    expect(parseLink(null)).toEqual({});
  });
});
