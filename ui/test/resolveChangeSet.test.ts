import { describe, expect, it } from 'vitest';

import { resolveChangeSet } from '../src/resolveChangeSet';
import { changeSet } from './fixtures';

const CHANGE_SETS = [
  changeSet({ id: 1, effective: '2020-01-01T00:00:00.000Z' }),
  changeSet({ id: 2, effective: '2021-01-01T00:00:00.000Z' }),
  changeSet({ id: 3, effective: '2022-01-01T00:00:00.000Z' }),
];

describe('resolveChangeSet', () => {
  it('resolves the latest change set effective at the instant', () => {
    expect(resolveChangeSet(CHANGE_SETS, new Date('2021-06-01T00:00:00.000Z'))?.id).toBe(2);
  });

  it('includes a change set effective exactly at the instant', () => {
    expect(resolveChangeSet(CHANGE_SETS, new Date('2021-01-01T00:00:00.000Z'))?.id).toBe(2);
  });

  it('ignores change sets effective in the future', () => {
    expect(resolveChangeSet(CHANGE_SETS, new Date('2030-01-01T00:00:00.000Z'))?.id).toBe(3);
  });

  it('resolves nothing before the first change set', () => {
    expect(resolveChangeSet(CHANGE_SETS, new Date('2019-01-01T00:00:00.000Z'))).toBeUndefined();
  });

  it('prefers the highest id when the effective dates tie', () => {
    const tied = [changeSet({ id: 5, effective: '2021-01-01T00:00:00.000Z' }), changeSet({ id: 4, effective: '2021-01-01T00:00:00.000Z' }), changeSet({ id: 6, effective: '2020-06-01T00:00:00.000Z' })];
    expect(resolveChangeSet(tied, new Date('2021-06-01T00:00:00.000Z'))?.id).toBe(5);
  });

  it('prefers the latest effective date over a higher id', () => {
    const changeSets = [changeSet({ id: 9, effective: '2020-01-01T00:00:00.000Z' }), changeSet({ id: 2, effective: '2021-01-01T00:00:00.000Z' })];
    expect(resolveChangeSet(changeSets, new Date('2021-06-01T00:00:00.000Z'))?.id).toBe(2);
  });

  it('does not depend on the order given', () => {
    expect(resolveChangeSet([...CHANGE_SETS].reverse(), new Date('2021-06-01T00:00:00.000Z'))?.id).toBe(2);
  });
});
