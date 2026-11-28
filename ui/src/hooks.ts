import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { useLocation } from 'preact-iso';

import { ApiError } from './api';
import { type NestState, loadNests, saveNests } from './nests';
import { type Screen, type View, loadView, saveView, withView } from './views';

export type Resource<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'error'; error: ApiError };

export function useResource<T>(load: () => Promise<T>, key: string): Resource<T> {
  const state = useSignal<Resource<T>>({ status: 'loading' });
  useEffect(() => {
    let current = true;
    state.value = { status: 'loading' };
    load().then(
      (data) => {
        if (current) state.value = { status: 'ready', data };
      },
      (err) => {
        if (current) state.value = { status: 'error', error: toApiError(err) };
      },
    );
    return () => {
      current = false;
    };
  }, [key]);
  return state.value;
}

export function useNests(key: string): [NestState, (state: NestState) => void] {
  const state = useSignal<NestState>({});
  useEffect(() => {
    state.value = loadNests(key);
  }, [key]);
  const update = (next: NestState) => {
    state.value = next;
    saveNests(key, next);
  };
  return [state.value, update];
}

// The view named by the URL, else the one last chosen on this type of screen, else the screen's default. A remembered JSON view is put in the URL so the address on screen links to what is shown.
export function useView(screen: Screen): [View, (view: View) => void] {
  const { url, route } = useLocation();
  const param = useQuery().get('view');
  const view: View = param === 'json' ? 'json' : param !== null ? 'ui' : (loadView(screen) ?? 'ui');
  useEffect(() => {
    if (param === null && view === 'json') route(withView(url, view), true);
  }, [url]);
  const update = (next: View) => {
    saveView(screen, next);
    route(withView(url, next));
  };
  return [view, update];
}

export function useEscape(href: string | undefined) {
  const { route } = useLocation();
  useEffect(() => {
    if (!href) return;
    const listener = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return target.blur();
      route(href);
    };
    addEventListener('keydown', listener);
    return () => removeEventListener('keydown', listener);
  }, [href, route]);
}

export function useQuery() {
  const { url } = useLocation();
  return new URLSearchParams(new URL(url, location.origin).search);
}

function toApiError(err: unknown) {
  if (err instanceof ApiError) return err;
  return new ApiError(0, err instanceof Error ? err.message : String(err));
}
