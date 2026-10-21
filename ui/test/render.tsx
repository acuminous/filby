import { render } from '@testing-library/preact';

import { App } from '../src/app';

export function renderAt(url: string) {
  history.replaceState(null, '', url);
  return render(<App />);
}
