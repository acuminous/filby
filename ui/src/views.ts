export type Screen = 'change-sets' | 'documents';

export type View = 'timeline' | 'table' | 'json';

// The view each screen opens in when neither the URL nor storage names one.
export const DEFAULT_VIEW: Record<Screen, View> = { 'change-sets': 'timeline', documents: 'table' };

export function viewKey(screen: Screen) {
  return `filby-ui/view/${screen}`;
}

export function loadView(screen: Screen): View | undefined {
  try {
    const stored = localStorage.getItem(viewKey(screen));
    return stored === 'json' || stored === DEFAULT_VIEW[screen] ? stored : undefined;
  } catch {
    return undefined;
  }
}

export function saveView(screen: Screen, view: View) {
  try {
    localStorage.setItem(viewKey(screen), view);
  } catch {}
}

// The URL with view=json when the view is JSON and without a view otherwise.
export function withView(url: string, view: View) {
  const next = new URL(url, location.origin);
  if (view === 'json') next.searchParams.set('view', 'json');
  else next.searchParams.delete('view');
  return `${next.pathname}${next.search}`;
}

// The query without the view, which is the UI's and not the API's.
export function withoutView(query: URLSearchParams) {
  const next = new URLSearchParams(query);
  next.delete('view');
  return next;
}
