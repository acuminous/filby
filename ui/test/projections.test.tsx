import { fireEvent, screen, waitFor } from '@testing-library/preact';
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

describe('Projections', () => {
  it('shows a loading state', () => {
    stub();
    renderAt('/');
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('lists the projections with their shape from the OpenAPI document', async () => {
    stub();
    renderAt('/');
    const rows = await screen.findAllByRole('row');
    expect(rows).toHaveLength(4);
    const cells = (index: number) => Array.from(rows[index]?.querySelectorAll('td') ?? []).map((cell) => cell.textContent?.trim());
    expect(cells(1)).toEqual(['Parks', 'v1', 'Holiday parks and their seasons', 'codename', 'code', 'seasons', '2 (max 3)']);
    expect(cells(2)).toEqual(['VAT Rates', 'v1', 'null', 'typerate', 'typetypesinraterange', 'none', '10']);
    expect(cells(3)).toEqual(['Summary', 'v3', 'A function', 'function rows', 'none', 'none', 'on request']);
  });

  it('shows nested arrays to any depth', async () => {
    stubApi({ '/api/projections': { body: [projection()] }, '/api/openapi.json': { body: openapi({ '/projections/Parks/v1': deep() }) } });
    renderAt('/');
    const row = (await screen.findAllByRole('row'))[1];
    expect(Array.from(row?.querySelectorAll('td') ?? []).map((cell) => cell.textContent)).toEqual(['Parks', 'v1', 'Holiday parks and their seasons', 'id', 'none', 'aa.b', 'none']);
  });

  it('opens the change sets on click', async () => {
    stub();
    renderAt('/');
    fireEvent.click(await screen.findByText('VAT Rates'));
    await waitFor(() => expect(location.pathname).toBe('/projections/VAT%20Rates/v1'));
  });

  it('opens the change sets with Enter on a focusable row', async () => {
    stub();
    renderAt('/');
    const row = (await screen.findByText('Parks')).closest('tr') as HTMLTableRowElement;
    expect(row.tabIndex).toBe(0);
    fireEvent.keyDown(row, { key: 'Enter' });
    await waitFor(() => expect(location.pathname).toBe('/projections/Parks/v1'));
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
