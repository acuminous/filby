import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { useLocation } from 'preact-iso';

import { ApiError } from './api';

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
