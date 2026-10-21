import type { ComponentChildren } from 'preact';
import { useLocation } from 'preact-iso';

type Props = { href: string; class?: string; selected?: boolean; children: ComponentChildren };

export function LinkRow({ href, class: className, selected, children }: Props) {
  const { route } = useLocation();
  const open = () => route(href);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    open();
  };
  return (
    <tr class={className} tabIndex={0} aria-selected={selected} onClick={open} onKeyDown={onKeyDown}>
      {children}
    </tr>
  );
}
