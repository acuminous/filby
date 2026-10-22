export type NestState = Record<string, boolean>;

export function storageKey(name: string, version: number) {
  return `filby-ui/nests/${name}/v${version}`;
}

export function loadNests(key: string): NestState {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}');
    return Object.fromEntries(Object.entries(stored).filter(([, value]) => typeof value === 'boolean')) as NestState;
  } catch {
    return {};
  }
}

export function saveNests(key: string, state: NestState) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {}
}

export function isOpen(state: NestState, path: string, row: string) {
  return state[`${path}#${row}`] ?? state[path] ?? false;
}

export function withRow(state: NestState, path: string, row: string, open: boolean): NestState {
  return { ...state, [`${path}#${row}`]: open };
}

export function withAll(state: NestState, path: string, open: boolean): NestState {
  return { ...Object.fromEntries(Object.entries(state).filter(([key]) => !key.startsWith(`${path}#`))), [path]: open };
}
