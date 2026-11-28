import type { ChangeSet } from './types';

export function resolveChangeSet(changeSets: ChangeSet[], instant: Date): ChangeSet | undefined {
  return changeSets
    .filter((changeSet) => Date.parse(changeSet.effective) <= instant.getTime())
    .sort((a, b) => Date.parse(b.effective) - Date.parse(a.effective) || b.id - a.id)[0];
}
