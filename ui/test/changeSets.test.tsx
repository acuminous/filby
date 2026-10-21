import { fireEvent, screen, waitFor } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { changeSet, stubApi } from './fixtures';
import { renderAt } from './render';

const CHANGE_SETS = [
  changeSet({ id: 1, effective: '2020-01-01T00:00:00.000Z', description: '2020 Parks' }),
  changeSet({ id: 2, effective: '2021-01-01T00:00:00.000Z', description: '2021 Parks', entityTag: 'ffff0000' }),
  changeSet({ id: 3, effective: '2022-01-01T00:00:00.000Z', description: '2022 Parks' }),
];

describe('Change sets', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2021-06-15T12:00:00.000Z'), toFake: ['Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists the change sets newest first, marking the live one and flagging future ones', async () => {
    const requests = stubApi({ '/api/changelog': { body: CHANGE_SETS } });
    renderAt('/projections/VAT%20Rates/v1');
    const rows = await screen.findAllByRole('row');
    expect(requests.map(String)).toEqual(['http://localhost/api/changelog?projection=VAT+Rates&version=1']);
    expect(screen.getByRole('heading').textContent).toBe('VAT Rates v1');
    expect(screen.getByText('3 change sets')).toBeTruthy();
    const cells = (index: number) => Array.from(rows[index]?.querySelectorAll('td') ?? []).map((cell) => cell.textContent?.trim());
    expect(cells(1)).toEqual(['3', '2022-01-01 00:00', '2022 Parks', '2019-12-01 10:30', 'a1b2c3d4', 'not yet live']);
    expect(cells(2)).toEqual(['2', '2021-01-01 00:00', '2021 Parks', '2019-12-01 10:30', 'ffff0000', 'liveas of']);
    expect(cells(3)).toEqual(['1', '2020-01-01 00:00', '2020 Parks', '2019-12-01 10:30', 'a1b2c3d4', '']);
    expect(rows[2]?.getAttribute('aria-selected')).toBe('true');
  });

  it('shows the UTC value of a date on hover', async () => {
    stubApi({ '/api/changelog': { body: CHANGE_SETS } });
    renderAt('/projections/Parks/v1');
    const time = await screen.findByText('2022-01-01 00:00');
    expect(time.getAttribute('title')).toBe('2022-01-01T00:00:00.000Z');
  });

  it('defaults the as of instant to now and resolves the change set in force at the chosen instant', async () => {
    stubApi({ '/api/changelog': { body: CHANGE_SETS } });
    renderAt('/projections/Parks/v1');
    const input = (await screen.findByLabelText(/As of/)) as HTMLInputElement;
    expect(input.value).toBe('2021-06-15T12:00');
    expect(screen.getByText('change set 2')).toBeTruthy();
    fireEvent.input(input, { target: { value: '2020-06-01T00:00' } });
    expect(await screen.findByText('change set 1')).toBeTruthy();
    const rows = screen.getAllByRole('row');
    expect(rows[3]?.getAttribute('aria-selected')).toBe('true');
    expect(rows[3]?.textContent).toContain('as of');
    expect(rows[2]?.textContent).toContain('live');
    expect(rows[2]?.textContent).not.toContain('as of');
    fireEvent.input(input, { target: { value: '2019-06-01T00:00' } });
    expect(await screen.findByText('no change set in force')).toBeTruthy();
  });

  it('opens the documents at a change set', async () => {
    stubApi({ '/api/changelog': { body: CHANGE_SETS } });
    renderAt('/projections/Parks/v1');
    fireEvent.click(await screen.findByText('2021 Parks'));
    await waitFor(() => expect(location.pathname).toBe('/projections/Parks/v1/change-sets/2'));
  });

  it('goes up to the projections with Escape', async () => {
    stubApi({ '/api/changelog': { body: CHANGE_SETS } });
    renderAt('/projections/Parks/v1');
    await screen.findByText('2021 Parks');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(location.pathname).toBe('/'));
  });

  it('blurs an input with Escape instead of leaving', async () => {
    stubApi({ '/api/changelog': { body: CHANGE_SETS } });
    renderAt('/projections/Parks/v1');
    const input = await screen.findByLabelText(/As of/);
    input.focus();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(document.activeElement).not.toBe(input);
    expect(location.pathname).toBe('/projections/Parks/v1');
  });

  it('shows the API error', async () => {
    stubApi({ '/api/changelog': { status: 404, body: { error: "Projection 'Parks v9' does not exist" } } });
    renderAt('/projections/Parks/v9');
    expect((await screen.findByRole('alert')).textContent).toBe("Error 404 Projection 'Parks v9' does not exist");
  });

  it('says when there are no change sets', async () => {
    stubApi({ '/api/changelog': { body: [] } });
    renderAt('/projections/Parks/v1');
    expect(await screen.findByText('No change sets')).toBeTruthy();
    expect(screen.getByText('no change set in force')).toBeTruthy();
  });
});
