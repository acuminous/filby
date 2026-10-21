import type { ApiError } from '../api';

export function Loading() {
  return (
    <p class="loading" aria-live="polite">
      Loading…
    </p>
  );
}

export function ErrorMessage({ error }: { error: ApiError }) {
  return (
    <div class="error" role="alert">
      <strong>{error.status ? `Error ${error.status}` : 'Error'}</strong> {error.message}
    </div>
  );
}
