import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

import { CHANGE_SET_ID, PAGE, PAGE_SIZE, type Routes, changeSet, declared, deep, detailed, detailedPark, linkRowPark, linkRows, openapi, operation, parameter, park, renamed, renamedPark, renamedSeason, renamedSeasons, stubApi, stubClipboard, unavailableStorage } from './fixtures';
import { renderAt } from './render';

const PARKS = [park(), park({ code: 'PV', name: null, seasons: [] })];

// Change set 2 was re-issued as 4, which takes its place in the change log
const REISSUED = [changeSet({ id: 1 }), changeSet({ id: 4, effective: '2021-01-01T00:00:00.000Z', description: '2021 Parks', reissuedFrom: 2 })];

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
    expect(await screen.findByText(/5 documents/)).toBeTruthy();
    expect(screen.getByRole('heading').textContent).toBe('Parks v1');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toBe('ProjectionsParks v1Change set 2');
    const picker = screen.getByLabelText('Change set') as HTMLSelectElement;
    expect(picker.value).toBe('2');
    expect(Array.from(picker.options).map((option) => option.textContent)).toEqual(['#2 2021 Parks', '#1 2020 Parks']);
    expect(screen.getByText('Jan 1, 2021, 12:00 AM').getAttribute('title')).toBe('2021-01-01T00:00:00.000Z');
    expect(requests.map(String)).toContain('http://localhost/api/projections/Parks/v1?changeSetId=2');
  });

  it('moves between change sets with the picker, keeping the filters', async () => {
    stub();
    renderAt('/projections/Parks/v1/change-sets/2?code=DC');
    const picker = (await screen.findByLabelText('Change set')) as HTMLSelectElement;
    fireEvent.change(picker, { target: { value: '1' } });
    await waitFor(() => expect(location.pathname).toBe('/projections/Parks/v1/change-sets/1'));
    expect(location.search).toBe('?code=DC');
  });

  it('renders the documents with nested arrays as collapsed sub-tables, dates in local time and nulls muted', async () => {
    stub();
    renderAt('/projections/Parks/v1/change-sets/2');
    const outer = (await screen.findByRole('table')) as HTMLTableElement;
    expect(within(outer).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['code', 'name']);
    const rows = Array.from(outer.querySelectorAll(':scope > tbody > tr'));
    expect(rows.map((row) => row.className)).toEqual(['', 'nest', '', 'nest']);
    expect(Array.from(rows[0]?.querySelectorAll('td') ?? []).map((td) => td.textContent)).toEqual(['DC', 'Devon Cliffs']);
    const details = rows[1]?.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')?.textContent).toBe('seasons 1');
    expect(details.querySelector('table')).toBeNull();
    fireEvent.click(details.querySelector('summary') as HTMLElement);
    expect(details.open).toBe(true);
    const inner = within(details).getByRole('table');
    expect(within(inner).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['type', 'start', 'end']);
    expect(Array.from(inner.querySelectorAll('td')).map((td) => td.textContent)).toEqual(['Guests', 'Mar 1, 2020, 12:00 AM', 'Nov 1, 2020, 12:00 AM']);
    expect(inner.querySelector('time')?.getAttribute('title')).toBe('2020-03-01T00:00:00.000Z');
    const second = Array.from(rows[2]?.querySelectorAll('td') ?? []);
    expect(second[1]?.textContent).toBe('null');
    expect(second[1]?.querySelector('.null')).toBeTruthy();
    expect(rows[3]?.querySelector('summary')?.textContent).toBe('seasons 0');
    expect(rows[3]?.querySelector('details')?.open).toBe(false);
    fireEvent.click(rows[3]?.querySelector('summary') as HTMLElement);
    expect(rows[3]?.querySelector('details')?.open).toBe(true);
    expect(rows[3]?.querySelector('table')).toBeNull();
  });

  it('expands and collapses every nest of a column, remembering the choice', async () => {
    stub();
    renderAt('/projections/Parks/v1/change-sets/2');
    const button = (await screen.findByRole('button', { name: 'seasons' })) as HTMLButtonElement;
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.title).toBe('Expand all seasons');
    fireEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.title).toBe('Collapse all seasons');
    expect(Array.from(document.querySelectorAll('details')).map((details) => details.open)).toEqual([true, true]);
    expect(screen.getAllByRole('table')).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem('filby-ui/nests/Parks/v1') ?? '')).toEqual({ seasons: true });
    fireEvent.click(screen.getAllByText('seasons')[1] as HTMLElement);
    expect(Array.from(document.querySelectorAll('details')).map((details) => details.open)).toEqual([false, true]);
    expect(JSON.parse(localStorage.getItem('filby-ui/nests/Parks/v1') ?? '')).toEqual({ seasons: true, 'seasons#0': false });
    fireEvent.click(button);
    expect(Array.from(document.querySelectorAll('details')).map((details) => details.open)).toEqual([false, false]);
    expect(JSON.parse(localStorage.getItem('filby-ui/nests/Parks/v1') ?? '')).toEqual({ seasons: false });
  });

  it('restores the nests that were open', async () => {
    localStorage.setItem('filby-ui/nests/Parks/v1', JSON.stringify({ seasons: true, 'seasons#1': false }));
    stub();
    renderAt('/projections/Parks/v1/change-sets/2');
    expect((await screen.findByRole('button', { name: 'seasons' })).getAttribute('aria-pressed')).toBe('true');
    expect(Array.from(document.querySelectorAll('details')).map((details) => details.open)).toEqual([true, false]);
  });

  it('renders with the nests collapsed when storage is unavailable', async () => {
    localStorage.setItem('filby-ui/nests/Parks/v1', JSON.stringify({ seasons: true }));
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('SecurityError');
      },
      setItem() {
        throw new Error('QuotaExceededError');
      },
    });
    stub();
    renderAt('/projections/Parks/v1/change-sets/2');
    const button = await screen.findByRole('button', { name: 'seasons' });
    expect(Array.from(document.querySelectorAll('details')).map((details) => details.open)).toEqual([false, false]);
    fireEvent.click(button);
    expect(Array.from(document.querySelectorAll('details')).map((details) => details.open)).toEqual([true, true]);
  });

  it('ignores stored state that is not a record of booleans', async () => {
    localStorage.setItem('filby-ui/nests/Parks/v1', '[1, 2');
    stub();
    renderAt('/projections/Parks/v1/change-sets/2');
    await screen.findByRole('button', { name: 'seasons' });
    expect(Array.from(document.querySelectorAll('details')).map((details) => details.open)).toEqual([false, false]);
  });

  it('renders nested arrays to any depth, expanding a column at any depth', async () => {
    stub({ '/api/openapi.json': { body: openapi({ '/projections/Parks/v1': deep() }) }, '/api/projections/Parks/v1': { body: [{ id: 1, a: [{ b: [{ c: 7 }, { c: 8 }] }] }] } });
    renderAt('/projections/Parks/v1/change-sets/2');
    expect((await screen.findAllByRole('button', { pressed: false })).map((button) => button.textContent)).toEqual(['a', 'a.b']);
    fireEvent.click(screen.getByRole('button', { name: 'a.b' }));
    expect(screen.getAllByRole('table')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'a' }));
    const tables = screen.getAllByRole('table');
    expect(tables).toHaveLength(3);
    expect(Array.from(tables[2]?.querySelectorAll('td') ?? []).map((td) => td.textContent)).toEqual(['7', '8']);
    expect(JSON.parse(localStorage.getItem('filby-ui/nests/Parks/v1') ?? '')).toEqual({ a: true, 'a.b': true });
  });

  it('renders lookups as columns of the parent table with bare names, prefixing a clash and underlining the join column', async () => {
    stub({ '/api/openapi.json': { body: openapi({ '/projections/Parks%20(Detailed)/v1': detailed() }) }, '/api/projections/Parks%20(Detailed)/v1': { body: [detailedPark()] } });
    renderAt('/projections/Parks%20(Detailed)/v1/change-sets/2');
    fireEvent.click(await screen.findByRole('button', { name: 'amenities' }));
    fireEvent.click(screen.getByRole('button', { name: 'beach_routes' }));
    const tables = screen.getAllByRole('table');
    expect(tables).toHaveLength(3);
    expect(tables[0]?.querySelectorAll(':scope > thead > tr')).toHaveLength(1);
    const amenities = tables[1] as HTMLTableElement;
    expect(amenities.querySelectorAll(':scope > thead > tr')).toHaveLength(1);
    const amenityHeaders = within(amenities).getAllByRole('columnheader');
    expect(amenityHeaders.map((th) => th.textContent)).toEqual(['amenity_code', 'name', 'category']);
    expect(amenityHeaders.map((th) => th.classList.contains('joined'))).toEqual([true, false, false]);
    expect(amenityHeaders.map((th) => th.title)).toEqual(['joins amenity on code', '', '']);
    const rows = Array.from(amenities.querySelectorAll(':scope > tbody > tr'));
    expect(Array.from(rows[0]?.querySelectorAll('td') ?? []).map((td) => td.textContent)).toEqual(['INDOOR_POOL', 'Indoor Pool', 'Pool']);
    expect(Array.from(rows[1]?.querySelectorAll('td') ?? []).map((td) => td.textContent)).toEqual(['LIDO', 'null', 'null']);
    expect(rows[1]?.querySelectorAll('td .null')).toHaveLength(2);
    const routes = tables[2] as HTMLTableElement;
    const routeHeaders = within(routes).getAllByRole('columnheader');
    expect(routeHeaders.map((th) => th.textContent)).toEqual(['name', 'distance_metres', 'code', 'beach.name', 'surfaces', 'surveyed']);
    expect(routeHeaders.map((th) => th.classList.contains('joined'))).toEqual([false, false, true, false, false, false]);
    expect(routeHeaders[2]?.title).toBe('joins beach on code');
    expect(Array.from(routes.querySelectorAll('td')).map((td) => td.textContent)).toEqual(['Cliff path', '400', 'SANDY_BAY', 'Sandy Bay', 'Sandy, Rocky', 'Mar 1, 2020, 12:00 AM']);
  });

  it('underlines nothing without the join fields', async () => {
    const unjoined = JSON.parse(JSON.stringify(detailed(), (key, value) => (key === 'x-filby-on' ? undefined : value)));
    stub({ '/api/openapi.json': { body: openapi({ '/projections/Parks%20(Detailed)/v1': unjoined }) }, '/api/projections/Parks%20(Detailed)/v1': { body: [detailedPark()] } });
    renderAt('/projections/Parks%20(Detailed)/v1/change-sets/2');
    fireEvent.click(await screen.findByRole('button', { name: 'amenities' }));
    fireEvent.click(screen.getByRole('button', { name: 'beach_routes' }));
    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['code', 'name', 'amenity_code', 'name', 'category', 'name', 'distance_metres', 'code', 'beach.name', 'surfaces', 'surveyed']);
    expect(document.querySelectorAll('th.joined')).toHaveLength(0);
    expect(screen.getAllByRole('columnheader').every((th) => th.title === '')).toBe(true);
  });

  it('renders renamed fields under their aliases, flattening a link row that carries only its lookup and underlining the renamed join column', async () => {
    stub({ '/api/openapi.json': { body: openapi({ '/projections/Parks%20(Renamed)/v1': renamed() }) }, '/api/projections/Parks%20(Renamed)/v1': { body: [renamedPark()] } });
    renderAt('/projections/Parks%20(Renamed)/v1/change-sets/2');
    fireEvent.click(await screen.findByRole('button', { name: 'amenities' }));
    const [parks, amenities] = screen.getAllByRole('table') as HTMLTableElement[];
    expect(Array.from(parks?.querySelectorAll(':scope > thead th') ?? []).map((th) => th.textContent)).toEqual(['park_code', 'name', 'area']);
    expect(Array.from(parks?.querySelectorAll(':scope > tbody > tr:not(.nest) > td') ?? []).map((td) => td.textContent)).toEqual(['DC', 'Devon Cliffs', 'South West']);
    const headers = within(amenities as HTMLTableElement).getAllByRole('columnheader');
    expect(headers.map((th) => th.textContent)).toEqual(['amenity_ref', 'amenity_name', 'category']);
    expect(headers.map((th) => th.title)).toEqual(['joins amenity on amenity_ref', '', '']);
    const rows = Array.from(amenities?.querySelectorAll(':scope > tbody > tr') ?? []);
    expect(rows.map((row) => Array.from(row.querySelectorAll('td')).map((td) => td.textContent))).toEqual([
      ['INDOOR_POOL', 'Indoor Pool', 'Pool'],
      ['null', 'null', 'null'],
    ]);
  });

  it('renders a link row that carries only a lookup and a nest as the lookup\'s columns with the nest beneath', async () => {
    stub({ '/api/projections/Parks/v1': { body: [linkRowPark()] }, '/api/openapi.json': { body: openapi({ '/projections/Parks/v1': linkRows() }) } });
    renderAt('/projections/Parks/v1/change-sets/2');
    fireEvent.click(await screen.findByRole('button', { name: 'models' }));
    fireEvent.click(screen.getByRole('button', { name: 'models.offers' }));
    const [, models, offers] = screen.getAllByRole('table') as HTMLTableElement[];
    const headers = Array.from(models?.querySelectorAll<HTMLTableCellElement>(':scope > thead th') ?? []);
    expect(headers.map((th) => th.textContent)).toEqual(['code', 'name']);
    expect(headers.map((th) => th.title)).toEqual(['joins model on code', '']);
    expect(Array.from(models?.querySelectorAll(':scope > tbody > tr:not(.nest) > td') ?? []).map((td) => td.textContent)).toEqual(['CLW', 'Willerby Clearwater Lodge']);
    expect(Array.from(offers?.querySelectorAll('td') ?? []).map((td) => td.textContent)).toEqual(['2026', '19995.00']);
  });

  it('underlines a renamed parent column that a lookup joins on', async () => {
    stub({ '/api/openapi.json': { body: openapi({ '/projections/Seasons%20(Renamed)/v1': renamedSeasons() }) }, '/api/projections/Seasons%20(Renamed)/v1': { body: [renamedSeason()] } });
    renderAt('/projections/Seasons%20(Renamed)/v1/change-sets/2');
    const table = (await screen.findByRole('table')) as HTMLTableElement;
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((th) => th.textContent)).toEqual(['park_ref', 'customer_type', 'opens', 'code', 'name']);
    expect(headers.map((th) => th.title)).toEqual(['joins park on code', '', '', '', '']);
    expect(Array.from(table.querySelectorAll('td')).map((td) => td.textContent)).toEqual(['DC', 'Guest', 'Mar 16, 2026, 12:00 AM', 'DC', 'Devon Cliffs']);
  });

  it('infers lookups from the documents', async () => {
    const rows = operation({ parameters: [CHANGE_SET_ID], responses: { 200: { description: 'Rows', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } } });
    stub({ '/api/openapi.json': { body: openapi({ '/projections/Parks/v1': rows }) }, '/api/projections/Parks/v1': { body: [{ park: 'DC', region: { name: 'South West' } }, { park: 'PV', region: null }] } });
    renderAt('/projections/Parks/v1/change-sets/2');
    const table = (await screen.findByRole('table')) as HTMLTableElement;
    expect(table.querySelectorAll(':scope > thead > tr')).toHaveLength(1);
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['park', 'name']);
    expect(table.querySelectorAll('th.joined')).toHaveLength(0);
    expect(Array.from(table.querySelectorAll('td')).map((td) => td.textContent)).toEqual(['DC', 'South West', 'PV', 'null']);
  });

  it('infers the columns of function rows from the documents', async () => {
    const rows = operation({ parameters: [CHANGE_SET_ID, PAGE, parameter('pageSize', { type: 'integer', minimum: 1 })], responses: { 200: { description: 'Rows', content: { 'application/json': { schema: { type: 'array', items: { type: 'object' } } } } } } });
    stub({ '/api/openapi.json': { body: openapi({ '/projections/Parks/v1': rows }) }, '/api/projections/Parks/v1': { body: [{ park: 'DC', total: 3, tags: ['a', 'b'], seasons: [{ type: 'Guests' }] }, { park: 'PV', total: 1, tags: [], seasons: [] }] } });
    renderAt('/projections/Parks/v1/change-sets/2');
    fireEvent.click(await screen.findByRole('button', { name: 'seasons' }));
    const tables = screen.getAllByRole('table');
    expect(tables).toHaveLength(2);
    expect(Array.from(tables[0]?.querySelectorAll(':scope > thead th') ?? []).map((th) => th.textContent)).toEqual(['park', 'total', 'tags']);
    expect(within(tables[1] as HTMLElement).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['type']);
    const cells = Array.from(tables[0]?.querySelectorAll(':scope > tbody > tr:not(.nest) td') ?? []).map((td) => td.textContent);
    expect(cells).toEqual(['DC', '3', 'a, b', 'PV', '1', 'empty']);
    expect(screen.getByText(/2 documents/)).toBeTruthy();
    expect(screen.getByText('1–2 of 2')).toBeTruthy();
  });

  it('builds filters from the parameters and reflects them in the URL', async () => {
    const parameters = [CHANGE_SET_ID, declared('code', 'equals', ['code']), declared('types', 'in', ['type'], { type: 'array', items: { type: 'string', enum: ['Owners', 'Guests'] } }), declared('rate_from', 'range', ['rate']), declared('rate_to', 'range', ['rate']), PAGE, PAGE_SIZE];
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
    const parameters = [CHANGE_SET_ID, declared('code', 'equals', ['code']), declared('types', 'in', ['type'], { type: 'array', items: { type: 'string' } }), declared('rate_from', 'range', ['rate']), declared('rate_to', 'range', ['rate'])];
    stub({ '/api/openapi.json': { body: openapi({ '/projections/Parks/v1': operation({ parameters }) }) } });
    renderAt('/projections/Parks/v1/change-sets/2?code=DC&types=a&types=b&rate_to=9');
    expect(((await screen.findByLabelText('code')) as HTMLInputElement).value).toBe('DC');
    expect((screen.getByLabelText(/types/) as HTMLInputElement).value).toBe('a, b');
    expect((screen.getByLabelText('from') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('to') as HTMLInputElement).value).toBe('9');
    fireEvent.click(screen.getByText('Clear'));
    await waitFor(() => expect(location.search).toBe(''));
  });

  it('captions each filter with its match and the field it filters', async () => {
    const parameters = [CHANGE_SET_ID, declared('code', 'equals', ['code']), declared('above', 'gt', ['rate']), declared('types', 'in', ['type'], { type: 'array', items: { type: 'string' } }), declared('rate_from', 'range', ['rate']), declared('rate_to', 'range', ['rate']), declared('region', 'equals')];
    stub({ '/api/openapi.json': { body: openapi({ '/projections/Parks/v1': operation({ parameters }) }) } });
    renderAt('/projections/Parks/v1/change-sets/2');
    const caption = (input: HTMLElement) => document.getElementById(input.getAttribute('aria-describedby') ?? '')?.textContent;
    expect(caption(await screen.findByLabelText('code'))).toBe('equals');
    expect(caption(screen.getByLabelText('above'))).toBe('gt rate');
    expect(caption(screen.getByLabelText(/types/))).toBe('in type');
    expect(caption(screen.getByLabelText('from'))).toBe('range');
    expect(caption(screen.getByLabelText('to'))).toBe('range');
    expect(caption(screen.getByLabelText('region'))).toBe('equals');
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('notes that a parameter on a nested field selects documents rather than filtering their nested rows', async () => {
    const parameters = [CHANGE_SET_ID, declared('code', 'equals', ['code']), declared('beach_surface', 'contains', ['beach_routes', 'beach', 'surfaces']), declared('amenity', 'equals', ['amenities', 'amenity_code'])];
    stub({ '/api/openapi.json': { body: openapi({ '/projections/Parks%20(Detailed)/v1': { ...detailed(), parameters } }) }, '/api/projections/Parks%20(Detailed)/v1': { body: [detailedPark()] } });
    renderAt('/projections/Parks%20(Detailed)/v1/change-sets/2');
    expect((await screen.findByRole('note')).textContent).toBe('beach_surface and amenity filter on nested fields, so they select which documents are returned and do not filter the nested rows inside them.');
  });

  it('notes a single parameter on a nested field', async () => {
    const parameters = [CHANGE_SET_ID, declared('beach_surface', 'contains', ['beach_routes', 'beach', 'surfaces'])];
    stub({ '/api/openapi.json': { body: openapi({ '/projections/Parks%20(Detailed)/v1': { ...detailed(), parameters } }) }, '/api/projections/Parks%20(Detailed)/v1': { body: [detailedPark()] } });
    renderAt('/projections/Parks%20(Detailed)/v1/change-sets/2');
    expect((await screen.findByRole('note')).textContent).toBe('beach_surface filters on a nested field, so it selects which documents are returned and does not filter the nested rows inside them.');
  });

  it('captions the filters on renamed fields with their aliases and notes the one inside a nest', async () => {
    const requests = stub({ '/api/openapi.json': { body: openapi({ '/projections/Parks%20(Renamed)/v1': renamed() }) }, '/api/projections/Parks%20(Renamed)/v1': { body: [renamedPark()] } });
    renderAt('/projections/Parks%20(Renamed)/v1/change-sets/2');
    const caption = (input: HTMLElement) => document.getElementById(input.getAttribute('aria-describedby') ?? '')?.textContent;
    expect(caption(await screen.findByLabelText('park_code'))).toBe('equals');
    expect(caption(screen.getByLabelText(/area/))).toBe('in');
    const amenity = screen.getByLabelText('amenity_name');
    expect(caption(amenity)).toBe('prefix amenities.amenity.amenity_name');
    expect(screen.getByRole('note').textContent).toBe('amenity_name filters on a nested field, so it selects which documents are returned and does not filter the nested rows inside them.');
    fireEvent.input(amenity, { target: { value: 'Indoor' } });
    fireEvent.submit(amenity.closest('form') as HTMLFormElement);
    await waitFor(() => expect(requests.at(-1)?.searchParams.get('amenity_name')).toBe('Indoor'));
  });

  it('filters a renamed date with a from and to pair', async () => {
    const requests = stub({ '/api/openapi.json': { body: openapi({ '/projections/Seasons%20(Renamed)/v1': renamedSeasons() }) }, '/api/projections/Seasons%20(Renamed)/v1': { body: [renamedSeason()] } });
    renderAt('/projections/Seasons%20(Renamed)/v1/change-sets/2?opens_from=2026-01-01T00:00:00.000Z');
    expect(((await screen.findByLabelText('from')) as HTMLInputElement).value).toBe('2026-01-01T00:00:00.000Z');
    await waitFor(() => expect(requests.at(-1)?.searchParams.get('opens_from')).toBe('2026-01-01T00:00:00.000Z'));
    expect(requests.at(-1)?.searchParams.has('opens_to')).toBe(false);
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
    expect(await screen.findByText(/2 documents/)).toBeTruthy();
    expect(screen.queryByText('Next')).toBeNull();
    expect(screen.queryByLabelText(/Page size/)).toBeNull();
  });

  it('goes up to the change sets with Escape', async () => {
    stub();
    renderAt('/projections/Parks/v1/change-sets/2');
    await screen.findByText(/5 documents/);
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
    const picker = screen.getByLabelText('Change set') as HTMLSelectElement;
    expect(picker.value).toBe('');
    expect(Array.from(picker.options).map((option) => option.textContent)).toEqual(['9', '#2 2021 Parks', '#1 2020 Parks']);
  });

  it('notes a re-issue in the picker and the header, linking to the change set it re-issues', async () => {
    stub({ '/api/changelog': { body: REISSUED } });
    renderAt('/projections/Parks/v1/change-sets/4?code=DC');
    expect(await screen.findByText(/5 documents/)).toBeTruthy();
    const picker = screen.getByLabelText('Change set') as HTMLSelectElement;
    expect(picker.value).toBe('4');
    expect(Array.from(picker.options).map((option) => option.textContent)).toEqual(['#4 2021 Parks (re-issues #2)', '#1 2020 Parks']);
    expect(document.querySelector('.page-header .muted')?.textContent).toBe('Effective Jan 1, 2021, 12:00 AM · re-issues change set 2 · 5 documents');
    fireEvent.click(screen.getByRole('link', { name: 'change set 2' }));
    await waitFor(() => expect(location.pathname).toBe('/projections/Parks/v1/change-sets/2'));
    expect(location.search).toBe('?code=DC');
  });

  it('says that a superseded change set was re-issued, linking to the re-issue', async () => {
    const requests = stub({ '/api/changelog': { body: REISSUED } });
    renderAt('/projections/Parks/v1/change-sets/2?code=DC');
    expect(await screen.findByText(/5 documents/)).toBeTruthy();
    expect(requests.map(String)).toContain('http://localhost/api/projections/Parks/v1?code=DC&changeSetId=2');
    expect(document.querySelector('.page-header .muted')?.textContent).toBe('re-issued as change set 4 · documents as originally published · 5 documents');
    expect(screen.queryByText("change set not in this projection's change log")).toBeNull();
    const picker = screen.getByLabelText('Change set') as HTMLSelectElement;
    expect(picker.value).toBe('');
    expect(Array.from(picker.options).map((option) => option.textContent)).toEqual(['2', '#4 2021 Parks (re-issues #2)', '#1 2020 Parks']);
    fireEvent.click(screen.getByRole('link', { name: 'change set 4' }));
    await waitFor(() => expect(location.pathname).toBe('/projections/Parks/v1/change-sets/4'));
    expect(location.search).toBe('?code=DC');
  });

  it('says a change set is not in the change log when the change log names only a later re-issue in its chain', async () => {
    // Change set 2 was re-issued as 3 and 3 as 4, so the change log names only 3
    stub({ '/api/changelog': { body: [changeSet({ id: 1 }), changeSet({ id: 4, effective: '2021-01-01T00:00:00.000Z', description: '2021 Parks', reissuedFrom: 3 })] } });
    renderAt('/projections/Parks/v1/change-sets/2');
    expect(await screen.findByText("change set not in this projection's change log")).toBeTruthy();
    expect(screen.queryByText(/re-issued as/)).toBeNull();
  });

  it('says when there are no documents', async () => {
    stub({ '/api/projections/Parks/v1': { body: [], headers: { 'X-Total-Count': '0' } } });
    renderAt('/projections/Parks/v1/change-sets/2');
    expect(await screen.findByText('No documents')).toBeTruthy();
    expect(screen.getByText('0–0 of 0')).toBeTruthy();
  });

  describe('JSON view', () => {
    const json = () => screen.getByLabelText('Response body');

    it('switches between the table and the JSON of the documents without a new request, remembering the choice', async () => {
      const requests = stub();
      renderAt('/projections/Parks/v1/change-sets/2');
      await screen.findByRole('table');
      expect((screen.getByRole('radio', { name: 'Table' }) as HTMLInputElement).checked).toBe(true);
      const count = requests.length;
      fireEvent.click(screen.getByRole('radio', { name: 'JSON' }));
      await waitFor(() => expect(location.search).toBe('?view=json'));
      expect(json().textContent).toBe(JSON.stringify(PARKS, null, 2));
      expect(Array.from(json().querySelectorAll('.null')).map((span) => span.textContent)).toEqual(['null']);
      expect(json().querySelector('.key')?.textContent).toBe('"code"');
      expect(json().querySelector('.string')?.textContent).toBe('"DC"');
      expect(screen.queryByRole('table')).toBeNull();
      expect(screen.queryByRole('button', { name: 'seasons' })).toBeNull();
      expect(screen.getByText('1–2 of 5')).toBeTruthy();
      expect(requests).toHaveLength(count);
      expect(localStorage.getItem('filby-ui/view/documents')).toBe('json');
      fireEvent.click(screen.getByRole('radio', { name: 'Table' }));
      await waitFor(() => expect(location.search).toBe(''));
      expect(await screen.findByRole('table')).toBeTruthy();
      expect(localStorage.getItem('filby-ui/view/documents')).toBe('table');
      expect(requests).toHaveLength(count);
    });

    it('colours booleans', async () => {
      stub({ '/api/projections/Parks/v1': { body: [{ code: 'DC', open: true, closed: false }] } });
      renderAt('/projections/Parks/v1/change-sets/2?view=json');
      const body = await screen.findByLabelText('Response body');
      expect(Array.from(body.querySelectorAll('.boolean')).map((span) => span.textContent)).toEqual(['true', 'false']);
    });

    it('shows the request URL, which leaves out the view, above the body', async () => {
      const requests = stub();
      renderAt('/projections/Parks/v1/change-sets/2?code=DC&view=json');
      await screen.findByLabelText('Response body');
      expect(screen.getByText(`${location.origin}/api/projections/Parks/v1?code=DC&changeSetId=2`)).toBeTruthy();
      expect(requests.map(String)).toContain('http://localhost/api/projections/Parks/v1?code=DC&changeSetId=2');
      expect(requests.some((url) => url.searchParams.has('view'))).toBe(false);
    });

    it('opens a link to the JSON view in the JSON view', async () => {
      stub();
      renderAt('/projections/Parks/v1/change-sets/2?view=json');
      expect((await screen.findByLabelText('Response body')).textContent).toBe(JSON.stringify(PARKS, null, 2));
      expect(screen.queryByRole('table')).toBeNull();
    });

    it('opens in the remembered view, putting it in the URL', async () => {
      localStorage.setItem('filby-ui/view/documents', 'json');
      stub();
      renderAt('/projections/Parks/v1/change-sets/2?code=DC');
      expect(await screen.findByLabelText('Response body')).toBeTruthy();
      await waitFor(() => expect(location.search).toBe('?code=DC&view=json'));
    });

    it('keeps the JSON view across pages, filters and change sets', async () => {
      const requests = stub();
      renderAt('/projections/Parks/v1/change-sets/2?view=json');
      fireEvent.click(await screen.findByText('Next'));
      await waitFor(() => expect(location.search).toBe('?view=json&page=2'));
      await waitFor(() => expect(requests.map(String)).toContain('http://localhost/api/projections/Parks/v1?page=2&changeSetId=2'));
      const code = screen.getByLabelText('code') as HTMLInputElement;
      fireEvent.input(code, { target: { value: 'DC' } });
      fireEvent.submit(code.closest('form') as HTMLFormElement);
      await waitFor(() => expect(location.search).toBe('?code=DC&view=json'));
      fireEvent.click(screen.getByText('Clear'));
      await waitFor(() => expect(location.search).toBe('?view=json'));
      fireEvent.change(screen.getByLabelText('Change set'), { target: { value: '1' } });
      await waitFor(() => expect(location.pathname).toBe('/projections/Parks/v1/change-sets/1'));
      expect(location.search).toBe('?view=json');
      expect(await screen.findByLabelText('Response body')).toBeTruthy();
    });

    it('shows an empty page as JSON', async () => {
      stub({ '/api/openapi.json': { body: openapi({ '/projections/Parks/v1': operation({ parameters: [CHANGE_SET_ID] }) }) }, '/api/projections/Parks/v1': { body: [] } });
      renderAt('/projections/Parks/v1/change-sets/2?view=json');
      expect((await screen.findByLabelText('Response body')).textContent).toBe('[]');
      expect(screen.queryByText('No documents')).toBeNull();
    });

    it('copies the JSON to the clipboard', async () => {
      const writeText = stubClipboard();
      stub();
      renderAt('/projections/Parks/v1/change-sets/2?view=json');
      fireEvent.click(await screen.findByRole('button', { name: 'Copy' }));
      expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
      expect(writeText).toHaveBeenCalledWith(JSON.stringify(PARKS, null, 2));
    });

    it('switches views when storage is unavailable', async () => {
      unavailableStorage();
      stub();
      renderAt('/projections/Parks/v1/change-sets/2');
      await screen.findByRole('table');
      fireEvent.click(screen.getByRole('radio', { name: 'JSON' }));
      expect((await screen.findByLabelText('Response body')).textContent).toBe(JSON.stringify(PARKS, null, 2));
      expect(location.search).toBe('?view=json');
    });
  });
});

describe('Unknown screen', () => {
  it('shows a 404', async () => {
    stub();
    renderAt('/nowhere');
    expect((await screen.findByRole('alert')).textContent).toBe('Error 404 No screen for /nowhere');
  });
});
