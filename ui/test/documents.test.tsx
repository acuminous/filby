import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';

import { CHANGE_SET_ID, PAGE, PAGE_SIZE, type Routes, changeSet, deep, openapi, operation, parameter, park, stubApi } from './fixtures';
import { renderAt } from './render';

const PARKS = [park(), park({ code: 'PV', name: null, seasons: [] })];

function stub(overrides: Routes = {}) {
  return stubApi({
    '/api/openapi.json': { body: openapi() },
    '/api/changelog': { body: [changeSet({ id: 1 }), changeSet({ id: 2, effective: '2021-01-01T00:00:00.000Z', description: '2021 Parks' })] },
    '/api/projections/Parks/v1': { body: PARKS, headers: { 'X-Total-Count': '5', Link: '</api/projections/Parks/v1?changeSetId=2&page=2>; rel="next"' } },
    ...overrides,
  });
}

describe('Documents', () => {
  it('shows the projection, the change set and the total', async () => {
    const requests = stub();
    renderAt('/projections/Parks/v1/change-sets/2');
    expect(await screen.findByText('5 documents')).toBeTruthy();
    expect(screen.getByRole('heading').textContent).toBe('Parks v1');
    expect(screen.getByText('2021 Parks')).toBeTruthy();
    expect(screen.getByText('2021-01-01 00:00').getAttribute('title')).toBe('2021-01-01T00:00:00.000Z');
    expect(requests.map(String)).toContain('http://localhost/api/projections/Parks/v1?changeSetId=2');
  });

  it('renders the documents with nested arrays as sub-tables, dates in local time and nulls muted', async () => {
    stub();
    renderAt('/projections/Parks/v1/change-sets/2');
    const tables = await screen.findAllByRole('table');
    expect(tables).toHaveLength(2);
    const outer = tables[0] as HTMLTableElement;
    expect(within(outer).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['code', 'name', 'type', 'start', 'end']);
    const rows = Array.from(outer.querySelectorAll(':scope > tbody > tr'));
    expect(rows.map((row) => row.className)).toEqual(['', 'nest', '', 'nest']);
    expect(Array.from(rows[0]?.querySelectorAll('td') ?? []).map((td) => td.textContent)).toEqual(['DC', 'Devon Cliffs']);
    const details = rows[1]?.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(true);
    expect(details.querySelector('summary')?.textContent).toBe('seasons 1');
    const inner = within(details).getByRole('table');
    expect(within(inner).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['type', 'start', 'end']);
    expect(Array.from(inner.querySelectorAll('td')).map((td) => td.textContent)).toEqual(['Guests', '2020-03-01 00:00', '2020-11-01 00:00']);
    expect(inner.querySelector('time')?.getAttribute('title')).toBe('2020-03-01T00:00:00.000Z');
    const second = Array.from(rows[2]?.querySelectorAll('td') ?? []);
    expect(second[1]?.textContent).toBe('null');
    expect(second[1]?.querySelector('.null')).toBeTruthy();
    expect(rows[3]?.querySelector('summary')?.textContent).toBe('seasons 0');
    expect(rows[3]?.querySelector('table')).toBeNull();
  });

  it('renders nested arrays to any depth', async () => {
    stub({ '/api/openapi.json': { body: openapi({ '/projections/Parks/v1': deep() }) }, '/api/projections/Parks/v1': { body: [{ id: 1, a: [{ b: [{ c: 7 }, { c: 8 }] }] }] } });
    renderAt('/projections/Parks/v1/change-sets/2');
    const tables = await screen.findAllByRole('table');
    expect(tables).toHaveLength(3);
    expect(Array.from(tables[2]?.querySelectorAll('td') ?? []).map((td) => td.textContent)).toEqual(['7', '8']);
  });

  it('infers the columns of function rows from the documents', async () => {
    const rows = operation({ parameters: [CHANGE_SET_ID, PAGE, parameter('pageSize', { type: 'integer', minimum: 1 })], responses: { 200: { description: 'Rows', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } } });
    stub({ '/api/openapi.json': { body: openapi({ '/projections/Parks/v1': rows }) }, '/api/projections/Parks/v1': { body: [{ park: 'DC', total: 3, tags: ['a', 'b'], seasons: [{ type: 'Guests' }] }, { park: 'PV', total: 1, tags: [], seasons: [] }] } });
    renderAt('/projections/Parks/v1/change-sets/2');
    const tables = await screen.findAllByRole('table');
    expect(within(tables[0] as HTMLElement).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['park', 'total', 'tags', 'type']);
    const cells = Array.from(tables[0]?.querySelectorAll(':scope > tbody > tr:not(.nest) td') ?? []).map((td) => td.textContent);
    expect(cells).toEqual(['DC', '3', 'a, b', 'PV', '1', 'empty']);
    expect(screen.getByText('2 documents')).toBeTruthy();
    expect(screen.getByText('1–2 of 2')).toBeTruthy();
  });

  it('builds filters from the parameters and reflects them in the URL', async () => {
    const parameters = [CHANGE_SET_ID, parameter('code'), parameter('types', { type: 'array', items: { type: 'string', enum: ['Owners', 'Guests'] } }), parameter('rate_from'), parameter('rate_to'), PAGE, PAGE_SIZE];
    const requests = stub({ '/api/openapi.json': { body: openapi({ '/projections/Parks/v1': operation({ parameters }) }) } });
    renderAt('/projections/Parks/v1/change-sets/2?pageSize=3&page=2');
    const code = (await screen.findByLabelText('code')) as HTMLInputElement;
    const types = screen.getByLabelText(/types/) as HTMLInputElement;
    const from = screen.getByLabelText('from') as HTMLInputElement;
    const to = screen.getByLabelText('to') as HTMLInputElement;
    expect(types.getAttribute('list')).toBe('types-values');
    expect(Array.from(document.querySelectorAll('#types-values option')).map((option) => option.getAttribute('value'))).toEqual(['Owners', 'Guests']);
    fireEvent.input(code, { target: { value: ' DC ' } });
    fireEvent.input(types, { target: { value: 'Owners, Guests,' } });
    fireEvent.input(from, { target: { value: '0.1' } });
    fireEvent.input(to, { target: { value: '' } });
    fireEvent.submit(code.closest('form') as HTMLFormElement);
    await waitFor(() => expect(location.search).toBe('?code=DC&types=Owners&types=Guests&rate_from=0.1&pageSize=3'));
    await waitFor(() => expect(requests.map(String)).toContain('http://localhost/api/projections/Parks/v1?code=DC&types=Owners&types=Guests&rate_from=0.1&pageSize=3&changeSetId=2'));
  });

  it('fills the filters from the URL and clears them', async () => {
    const parameters = [CHANGE_SET_ID, parameter('code'), parameter('types', { type: 'array', items: { type: 'string' } }), parameter('rate_from'), parameter('rate_to')];
    stub({ '/api/openapi.json': { body: openapi({ '/projections/Parks/v1': operation({ parameters }) }) } });
    renderAt('/projections/Parks/v1/change-sets/2?code=DC&types=a&types=b&rate_to=9');
    expect(((await screen.findByLabelText('code')) as HTMLInputElement).value).toBe('DC');
    expect((screen.getByLabelText(/types/) as HTMLInputElement).value).toBe('a, b');
    expect((screen.getByLabelText('from') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('to') as HTMLInputElement).value).toBe('9');
    fireEvent.click(screen.getByText('Clear'));
    await waitFor(() => expect(location.search).toBe(''));
  });

  it('pages with the Link header and the total', async () => {
    const requests = stub({
      '/api/projections/Parks/v1': (url) =>
        url.searchParams.get('page') === '2'
          ? { body: [park({ code: 'C' }), park({ code: 'D' })], headers: { 'X-Total-Count': '5', Link: '</api/projections/Parks/v1?changeSetId=2&page=1>; rel="prev", </api/projections/Parks/v1?changeSetId=2&page=3>; rel="next"' } }
          : { body: PARKS, headers: { 'X-Total-Count': '5', Link: '</api/projections/Parks/v1?changeSetId=2&page=2>; rel="next"' } },
    });
    renderAt('/projections/Parks/v1/change-sets/2');
    expect(await screen.findByText('1–2 of 5')).toBeTruthy();
    const previous = screen.getByText('Previous') as HTMLButtonElement;
    const next = screen.getByText('Next') as HTMLButtonElement;
    expect(previous.disabled).toBe(true);
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    await waitFor(() => expect(location.search).toBe('?page=2'));
    expect(await screen.findByText('3–4 of 5')).toBeTruthy();
    expect((screen.getByText('Previous') as HTMLButtonElement).disabled).toBe(false);
    expect(requests.map(String)).toContain('http://localhost/api/projections/Parks/v1?page=2&changeSetId=2');
    fireEvent.click(screen.getByText('Previous'));
    await waitFor(() => expect(location.search).toBe(''));
  });

  it('bounds the page size by the maximum and resets the page', async () => {
    stub();
    renderAt('/projections/Parks/v1/change-sets/2?page=2');
    const input = (await screen.findByLabelText(/Page size/)) as HTMLInputElement;
    expect(input.value).toBe('2');
    expect(input.getAttribute('max')).toBe('3');
    expect(screen.getByText('max 3')).toBeTruthy();
    fireEvent.change(input, { target: { value: '9' } });
    await waitFor(() => expect(location.search).toBe('?pageSize=3'));
  });

  it('omits paging when the projection has none', async () => {
    stub({ '/api/openapi.json': { body: openapi({ '/projections/Parks/v1': operation({ parameters: [CHANGE_SET_ID, parameter('code')] }) }) }, '/api/projections/Parks/v1': { body: PARKS, headers: { 'X-Total-Count': '2' } } });
    renderAt('/projections/Parks/v1/change-sets/2');
    expect(await screen.findByText('2 documents')).toBeTruthy();
    expect(screen.queryByText('Next')).toBeNull();
    expect(screen.queryByLabelText(/Page size/)).toBeNull();
  });

  it('goes up to the change sets with Escape', async () => {
    stub();
    renderAt('/projections/Parks/v1/change-sets/2');
    await screen.findByText('5 documents');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(location.pathname).toBe('/projections/Parks/v1'));
  });

  it('shows the API error for the documents', async () => {
    stub({ '/api/projections/Parks/v1': { status: 400, body: { error: "Projection 'Parks v1' has no parameter 'colour'" } } });
    renderAt('/projections/Parks/v1/change-sets/2?colour=red');
    expect((await screen.findByRole('alert')).textContent).toBe("Error 400 Projection 'Parks v1' has no parameter 'colour'");
  });

  it('says when the change set is not in the change log', async () => {
    stub({ '/api/projections/Parks/v1': { status: 400, body: { error: 'Change set 9 does not exist' } } });
    renderAt('/projections/Parks/v1/change-sets/9');
    expect((await screen.findByRole('alert')).textContent).toBe('Error 400 Change set 9 does not exist');
    expect(screen.getByText("change set not in this projection's change log")).toBeTruthy();
  });

  it('says when there are no documents', async () => {
    stub({ '/api/projections/Parks/v1': { body: [], headers: { 'X-Total-Count': '0' } } });
    renderAt('/projections/Parks/v1/change-sets/2');
    expect(await screen.findByText('No documents')).toBeTruthy();
    expect(screen.getByText('0–0 of 0')).toBeTruthy();
  });
});

describe('Unknown screen', () => {
  it('shows a 404', async () => {
    stub();
    renderAt('/nowhere');
    expect((await screen.findByRole('alert')).textContent).toBe('Error 404 No screen for /nowhere');
  });
});
