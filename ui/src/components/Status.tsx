import { CircleAlert, Inbox } from 'lucide-preact';

import type { ApiError } from '../api';

export function Loading() {
  return (
    <p class="state" aria-live="polite">
      <span class="loading loading-spinner loading-xs" aria-hidden="true" />
      Loading…
    </p>
  );
}

export function Empty({ children }: { children: string }) {
  return (
    <p class="state">
      <Inbox size={16} aria-hidden="true" />
      {children}
    </p>
  );
}

export function ErrorMessage({ error }: { error: ApiError }) {
  return (
    <div class="alert alert-error alert-soft" role="alert">
      <CircleAlert size={18} aria-hidden="true" />
      <span>
        <strong>{error.status ? `Error ${error.status}` : 'Error'}</strong> {error.message}
      </span>
    </div>
  );
}
