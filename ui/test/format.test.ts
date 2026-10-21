import { describe, expect, it } from 'vitest';

import { formatDateTime, plural, timeZone, toDateTimeLocal } from '../src/format';

describe('formatDateTime', () => {
  it('formats an instant in the given locale and the local time zone', () => {
    expect(formatDateTime('2020-03-01T09:05:00.000Z', 'en-GB')).toBe('1 Mar 2020, 09:05');
    expect(formatDateTime('2020-03-01T09:05:00.000Z', 'en-US')).toBe('Mar 1, 2020, 09:05 AM');
  });

  it('defaults to the browser locale', () => {
    expect(formatDateTime('2020-03-01T09:05:00.000Z')).toBe(formatDateTime('2020-03-01T09:05:00.000Z', navigator.language));
  });

  it('shows seconds only when they are present', () => {
    expect(formatDateTime('2020-03-01T09:05:07.000Z', 'en-GB')).toBe('1 Mar 2020, 09:05:07');
  });

  it('leaves an unparseable value alone', () => {
    expect(formatDateTime('whenever', 'en-GB')).toBe('whenever');
  });
});

describe('timeZone', () => {
  it('names the local time zone', () => {
    expect(timeZone()).toBe('UTC');
  });
});

describe('toDateTimeLocal', () => {
  it('formats a date for a datetime-local input', () => {
    expect(toDateTimeLocal(new Date('2020-03-01T09:05:07.000Z'))).toBe('2020-03-01T09:05');
  });
});

describe('plural', () => {
  it('counts nouns', () => {
    expect(plural(1, 'change set')).toBe('1 change set');
    expect(plural(0, 'document')).toBe('0 documents');
  });
});
