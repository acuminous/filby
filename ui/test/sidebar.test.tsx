import { fireEvent, screen, waitFor, within } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';

import { changeSet, openapi, projection, stubApi } from './fixtures';
import { renderAt } from './render';

describe('Sidebar', () => {
  it('lists the projections and marks the one on screen', async () => {
    stubApi({ '/api/projections': { body: [projection(), projection({ name: 'VAT Rates', version: 2 })] }, '/api/changelog': { body: [changeSet()] }, '/api/openapi.json': { body: openapi() } });
    renderAt('/projections/VAT%20Rates/v2');
    const sidebar = screen.getByRole('complementary');
    await within(sidebar).findByText('VAT Rates');
    const links = within(sidebar).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Filby', 'Parksv1', 'VAT Ratesv2']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/', '/projections/Parks/v1', '/projections/VAT%20Rates/v2']);
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([null, null, 'true']);
    expect(within(sidebar).getByText('Times are shown in UTC')).toBeTruthy();
    fireEvent.click(links[1] as HTMLAnchorElement);
    await waitFor(() => expect(location.pathname).toBe('/projections/Parks/v1'));
  });

  it('says when the projections cannot be listed without blocking the screen', async () => {
    stubApi({ '/api/projections': { status: 500, body: { error: 'Database unavailable' } }, '/api/changelog': { body: [changeSet()] } });
    renderAt('/projections/Parks/v1');
    expect(await screen.findByText('Projections unavailable')).toBeTruthy();
    expect(await screen.findByText('2020 Parks')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
