import { describe, expect, it } from 'vitest';

import { formatDateTime, toDateTimeLocal } from '../src/format';

describe('formatDateTime', () => {
  it('formats an instant in the local time zone', () => {
    expect(formatDateTime('2020-03-01T09:05:00.000Z')).toBe('2020-03-01 09:05');
  });

  it('shows seconds only when they are present', () => {
    expect(formatDateTime('2020-03-01T09:05:07.000Z')).toBe('2020-03-01 09:05:07');
  });

  it('leaves an unparseable value alone', () => {
    expect(formatDateTime('whenever')).toBe('whenever');
  });
});

describe('toDateTimeLocal', () => {
  it('formats a date for a datetime-local input', () => {
    expect(toDateTimeLocal(new Date('2020-03-01T09:05:07.000Z'))).toBe('2020-03-01T09:05');
  });
});
