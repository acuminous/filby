import type { ComponentChildren } from 'preact';

type Props = { name: string; version?: number; description?: string | null; children?: ComponentChildren };

export function PageHeader({ name, version, description, children }: Props) {
  return (
    <header class="page-header">
      <div>
        <h1>
          {name}
          {version !== undefined && <span class="version"> v{version}</span>}
        </h1>
        {description && <p class="description">{description}</p>}
      </div>
      {children && <div class="aside">{children}</div>}
    </header>
  );
}
