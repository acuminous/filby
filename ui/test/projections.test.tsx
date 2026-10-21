import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';

import { CHANGE_SET_ID, PAGE, deep, openapi, operation, parameter, projection, stubApi } from './fixtures';
import { renderAt } from './render';

const VAT_RATES = operation({
  summary: 'VAT Rates v1',
  parameters: [CHANGE_SET_ID, parameter('type', { type: 'string', enum: ['standard', 'reduced'] }), parameter('types', { type: 'array', items: { type: 'string' } }), parameter('rate_from'), parameter('rate_to'), PAGE, parameter('pageSize', { type: 'integer', minimum: 1, default: 10 })],
  responses: { 200: { description: 'Rates', content: { 'application/json': { schema: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, rate: { type: 'string' } } } } } } } },
});

const FUNCTION = operation({
  summary: 'Summary v3',
  parameters: [CHANGE_SET_ID, PAGE, parameter('pageSize', { type: 'integer', minimum: 1 })],
  responses: { 200: { description: 'Rows', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } },
});

function stub() {
  return stubApi({
    '/api/projections': { body: [projection(), projection({ name: 'VAT Rates', description: null }), projection({ name: 'Summary', version: 3, description: 'A function' })] },
    '/api/openapi.json': { body: openapi({ '/projections/Parks/v1': operation(), '/projections/VAT%20Rates/v1': VAT_RATES, '/projections/Summary/v3': FUNCTION }) },
  });
}

function main() {
  return within(screen.getByRole('main'));
}

async function entries() {
  const list = await main().findByRole('list');
  return within(list)
    .getAllByRole('listitem')
    .map((item) => ({
      title: item.querySelector('.title')?.textContent,
      description: item.querySelector('.description')?.textContent,
      details: Array.from(item.querySelectorAll('dd')).map((dd) => dd.textContent),
      href: item.querySelector('a')?.getAttribute('href'),
    }));
}

describe('Projections', () => {
  it('shows a loading state', () => {
    stub();
    renderAt('/');
    expect(main().getByText('Loading…')).toBeTruthy();
  });

  it('lists the projections with their shape from the OpenAPI document', async () => {
    stub();
    renderAt('/');
    expect(await entries()).toEqual([
      { title: 'Parksv1', description: 'Holiday parks and their seasons', details: ['codename', 'code', 'seasons', '2 per page, up to 3'], href: '/projections/Parks/v1' },
      { title: 'VAT Ratesv1', description: '', details: ['typerate', 'typetypesinraterange', 'none', '10 per page'], href: '/projections/VAT%20Rates/v1' },
      { title: 'Summaryv3', description: 'A function', details: ['function rows', 'none', 'none', 'on request'], href: '/projections/Summary/v3' },
    ]);
  });

  it('shows nested arrays to any depth', async () => {
    stubApi({ '/api/projections': { body: [projection()] }, '/api/openapi.json': { body: openapi({ '/projections/Parks/v1': deep() }) } });
    renderAt('/');
    expect((await entries())[0]?.details).toEqual(['id', 'none', 'aa.b', 'none']);
  });

  it('opens the change sets on click', async () => {
    stub();
    renderAt('/');
    fireEvent.click(await main().findByText('VAT Rates'));
    await waitFor(() => expect(location.pathname).toBe('/projections/VAT%20Rates/v1'));
  });

  it('shows the API error', async () => {
    stubApi({ '/api/projections': { status: 500, body: { error: 'Database unavailable' } }, '/api/openapi.json': { body: openapi() } });
    renderAt('/');
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Error 500 Database unavailable');
  });

  it('says when there are no projections', async () => {
    stubApi({ '/api/projections': { body: [] }, '/api/openapi.json': { body: openapi({}) } });
    renderAt('/');
    expect(await screen.findByText('No projections')).toBeTruthy();
  });
});
