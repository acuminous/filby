import { useSignal } from '@preact/signals';
import { Check, Copy } from 'lucide-preact';
import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';

import type { View } from '../views';

type ToggleProps = { views: [View, string][]; value: View; onChange: (view: View) => void };

export function ViewToggle({ views, value, onChange }: ToggleProps) {
  return (
    <fieldset class="join" aria-label="View">
      {views.map(([view, label]) => (
        <input type="radio" key={view} name="view" class="btn btn-sm join-item" aria-label={label} checked={view === value} onChange={() => onChange(view)} />
      ))}
    </fieldset>
  );
}

type Copied = 'idle' | 'copied' | 'failed';

// The response body as JSON.stringify(body, null, 2) prints it, so what is shown is what is copied, with each token in a span for colouring.
export function JsonBody({ url, body }: { url: string; body: unknown }) {
  const text = JSON.stringify(body, null, 2);
  const copied = useSignal<Copied>('idle');
  useEffect(() => {
    if (copied.value === 'idle') return;
    const timer = setTimeout(() => (copied.value = 'idle'), 2000);
    return () => clearTimeout(timer);
  }, [copied.value]);
  const copy = () =>
    Promise.resolve()
      .then(() => navigator.clipboard.writeText(text))
      .catch(() => copyThroughTextBox(text))
      .then(
        () => (copied.value = 'copied'),
        () => (copied.value = 'failed'),
      );
  return (
    <>
      <div class="head json-head">
        <code class="url">{new URL(url, location.origin).href}</code>
        <button type="button" class="btn btn-xs btn-ghost" onClick={copy}>
          {copied.value === 'copied' ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
          {copied.value === 'copied' ? 'Copied' : copied.value === 'failed' ? 'Copy failed' : 'Copy'}
        </button>
      </div>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the body scrolls, so it takes focus for the keyboard to scroll it */}
      <section class="json" aria-label="Response body" tabIndex={0}>
        <pre>
          <code>{tokens(body, '')}</code>
        </pre>
      </section>
    </>
  );
}

// The clipboard is missing outside a secure context, such as plain HTTP on a host other than localhost, and may refuse the copy.
// The deprecated copy command still works there, from a text box selected for the moment of the copy.
function copyThroughTextBox(text: string) {
  const focused = document.activeElement;
  const box = document.createElement('textarea');
  box.value = text;
  box.readOnly = true;
  box.setAttribute('aria-hidden', 'true');
  box.style.position = 'fixed';
  box.style.top = '0';
  box.style.left = '0';
  box.style.opacity = '0';
  document.body.append(box);
  try {
    box.focus();
    box.select();
    if (!document.execCommand('copy')) throw new Error('The copy command did not copy');
  } finally {
    box.remove();
    if (focused instanceof HTMLElement) focused.focus();
  }
}

function tokens(value: unknown, indent: string): ComponentChildren {
  if (value === null) return <span class="null">null</span>;
  if (typeof value === 'string') return <span class="string">{JSON.stringify(value)}</span>;
  if (typeof value === 'number') return <span class="number">{JSON.stringify(value)}</span>;
  if (typeof value === 'boolean') return <span class="boolean">{String(value)}</span>;
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return ['[\n', ...value.map((item, index) => [inner, tokens(item, inner), index < value.length - 1 ? ',\n' : '\n']), `${indent}]`];
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return '{}';
  return ['{\n', ...entries.map(([key, item], index) => [inner, <span class="key">{JSON.stringify(key)}</span>, ': ', tokens(item, inner), index < entries.length - 1 ? ',\n' : '\n']), `${indent}}`];
}
