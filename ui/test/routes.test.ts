import { describe, expect, it } from 'vitest';

import { changeSetsPath, documentsPath, parseVersion, projectionsPath } from '../src/routes';

describe('routes', () => {
  it('builds the paths with the projection name encoded', () => {
    expect(projectionsPath()).toBe('/');
    expect(changeSetsPath('VAT Rates', 2)).toBe('/projections/VAT%20Rates/v2');
    expect(documentsPath('VAT Rates', 2, 7)).toBe('/projections/VAT%20Rates/v2/change-sets/7');
    expect(documentsPath('Parks', 1, 7, new URLSearchParams([['types', 'a'], ['types', 'b']]))).toBe('/projections/Parks/v1/change-sets/7?types=a&types=b');
    expect(documentsPath('Parks', 1, 7, new URLSearchParams())).toBe('/projections/Parks/v1/change-sets/7');
  });

  it('parses a version segment', () => {
    expect(parseVersion('v12')).toBe(12);
    expect(parseVersion('12')).toBeUndefined();
    expect(parseVersion('vx')).toBeUndefined();
  });
});
