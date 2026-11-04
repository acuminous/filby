import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { changeSet, stubApi, stubClipboard, unavailableStorage } from './fixtures';
import { renderAt } from './render';

const CHANGE_SETS = [
  changeSet({ id: 1, effective: '2020-01-01T00:00:00.000Z', description: '2020 Parks' }),
  changeSet({ id: 2, effective: '2021-01-01T00:00:00.000Z', description: '2021 Parks', entityTag: 'ffff0000' }),
  changeSet({ id: 3, effective: '2022-01-01T00:00:00.000Z', description: '2022 Parks' }),
];

async function history() {
  const list = await within(screen.getByRole('main')).findByRole('list');
  return within(list)
    .getAllByRole('listitem')
    .map((item) => ({
      when: item.querySelector('.when')?.textContent,
      what: item.querySelector('.what')?.textContent,
      meta: item.querySelector('.meta')?.textContent,
      current: item.querySelector('a')?.getAttribute('aria-current'),
      reissued: item.querySelector('.reissued')?.textContent,
    }));
}

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
    const items = await history();
    expect(requests.map(String)).toContain('http://localhost/api/changelog?projection=VAT+Rates&version=1');
    expect(screen.getByRole('heading').textContent).toBe('VAT Rates v1');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toBe('ProjectionsVAT Rates v1');
    expect(screen.getByText('3 change sets')).toBeTruthy();
    expect(items).toEqual([
      { when: 'Jan 1, 2022, 12:00 AM', what: '#32022 Parksnot yet live', meta: 'modified Dec 1, 2019, 10:30 AM · a1b2c3d4', current: null },
      { when: 'Jan 1, 2021, 12:00 AM', what: '#22021 Parkslive', meta: 'modified Dec 1, 2019, 10:30 AM · ffff0000', current: 'true' },
      { when: 'Jan 1, 2020, 12:00 AM', what: '#12020 Parks', meta: 'modified Dec 1, 2019, 10:30 AM · a1b2c3d4', current: null },
    ]);
  });

  it('shows the UTC value of a date on hover', async () => {
    stubApi({ '/api/changelog': { body: CHANGE_SETS } });
    renderAt('/projections/Parks/v1');
    const time = await screen.findByText('Jan 1, 2022, 12:00 AM');
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
    const items = await history();
    expect(items.map(({ current }) => current)).toEqual([null, 'true', null]);
    expect(items[2]?.what).toContain('as of');
    expect(items[1]?.what).toContain('live');
    expect(items[1]?.what).not.toContain('as of');
    fireEvent.input(input, { target: { value: '2021-06-15T12:00' } });
    expect(await screen.findByText('change set 2')).toBeTruthy();
    expect((await history()).some(({ what }) => what?.includes('as of'))).toBe(false);
    fireEvent.input(input, { target: { value: '2019-06-01T00:00' } });
    expect(await screen.findByText('no change set in force')).toBeTruthy();
  });

  it('opens the documents at a change set', async () => {
    stubApi({ '/api/changelog': { body: CHANGE_SETS } });
    renderAt('/projections/Parks/v1');
    fireEvent.click(await screen.findByText('2021 Parks'));
    await waitFor(() => expect(location.pathname).toBe('/projections/Parks/v1/change-sets/2'));
  });

  it('says that a re-issue re-issues the earlier change set and links to the documents at it', async () => {
    stubApi({ '/api/changelog': { body: [changeSet({ id: 1 }), changeSet({ id: 4, effective: '2021-01-01T00:00:00.000Z', description: '2021 Parks', reissuedFrom: 2 })] } });
    renderAt('/projections/Parks/v1');
    const items = await history();
    expect(items.map(({ reissued }) => reissued)).toEqual(['Re-issues change set 2', undefined]);
    expect(items.map(({ what }) => what)).toEqual(['#42021 Parkslive', '#12020 Parks']);
    const link = screen.getByRole('link', { name: 'change set 2' });
    expect(link.parentElement?.closest('a')).toBeNull();
    fireEvent.click(link);
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

  describe('JSON view', () => {
    const json = () => screen.getByLabelText('Response body');

    it('switches between the timeline and the JSON of the change log without a new request, remembering the choice', async () => {
      const requests = stubApi({ '/api/changelog': { body: CHANGE_SETS } });
      renderAt('/projections/Parks/v1');
      await history();
      const timeline = screen.getByRole('radio', { name: 'Timeline' }) as HTMLInputElement;
      expect(timeline.checked).toBe(true);
      fireEvent.click(screen.getByRole('radio', { name: 'JSON' }));
      await waitFor(() => expect(location.search).toBe('?view=json'));
      expect(json().textContent).toBe(JSON.stringify(CHANGE_SETS, null, 2));
      expect(json().querySelector('.key')?.textContent).toBe('"id"');
      expect(json().querySelector('.number')?.textContent).toBe('1');
      expect(json().querySelector('.string')?.textContent).toBe('"2020-01-01T00:00:00.000Z"');
      expect(screen.getByText(`${location.origin}/api/changelog?projection=Parks&version=1`)).toBeTruthy();
      expect((screen.getByRole('radio', { name: 'JSON' }) as HTMLInputElement).checked).toBe(true);
      expect(within(screen.getByRole('main')).queryByRole('list')).toBeNull();
      expect(screen.queryByLabelText(/As of/)).toBeNull();
      expect(requests.filter(({ pathname }) => pathname === '/api/changelog')).toHaveLength(1);
      expect(localStorage.getItem('filby-ui/view/change-sets')).toBe('json');
      fireEvent.click(screen.getByRole('radio', { name: 'Timeline' }));
      await waitFor(() => expect(location.search).toBe(''));
      expect((await history()).length).toBe(3);
      expect(screen.queryByLabelText('Response body')).toBeNull();
      expect(localStorage.getItem('filby-ui/view/change-sets')).toBe('timeline');
      expect(requests.filter(({ pathname }) => pathname === '/api/changelog')).toHaveLength(1);
    });

    it('opens a link to the JSON view in the JSON view', async () => {
      stubApi({ '/api/changelog': { body: CHANGE_SETS } });
      renderAt('/projections/Parks/v1?view=json');
      expect((await screen.findByLabelText('Response body')).textContent).toBe(JSON.stringify(CHANGE_SETS, null, 2));
      expect(within(screen.getByRole('main')).queryByRole('list')).toBeNull();
    });

    it('opens in the remembered view, putting it in the URL', async () => {
      localStorage.setItem('filby-ui/view/change-sets', 'json');
      stubApi({ '/api/changelog': { body: CHANGE_SETS } });
      renderAt('/projections/Parks/v1');
      expect(await screen.findByLabelText('Response body')).toBeTruthy();
      await waitFor(() => expect(location.search).toBe('?view=json'));
    });

    it('copies the JSON to the clipboard', async () => {
      const writeText = stubClipboard();
      stubApi({ '/api/changelog': { body: CHANGE_SETS } });
      renderAt('/projections/Parks/v1?view=json');
      fireEvent.click(await screen.findByRole('button', { name: 'Copy' }));
      expect(writeText).toHaveBeenCalledWith(JSON.stringify(CHANGE_SETS, null, 2));
      expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    });

    it('says when the clipboard refuses the copy', async () => {
      stubClipboard(() => Promise.reject(new Error('NotAllowedError')));
      stubApi({ '/api/changelog': { body: CHANGE_SETS } });
      renderAt('/projections/Parks/v1?view=json');
      fireEvent.click(await screen.findByRole('button', { name: 'Copy' }));
      expect(await screen.findByRole('button', { name: 'Copy failed' })).toBeTruthy();
    });

    it('switches views when storage is unavailable', async () => {
      unavailableStorage();
      stubApi({ '/api/changelog': { body: CHANGE_SETS } });
      renderAt('/projections/Parks/v1');
      await history();
      fireEvent.click(screen.getByRole('radio', { name: 'JSON' }));
      expect((await screen.findByLabelText('Response body')).textContent).toBe(JSON.stringify(CHANGE_SETS, null, 2));
      expect(location.search).toBe('?view=json');
    });
  });
});
