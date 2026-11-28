import { ChevronRight } from 'lucide-preact';

export type Crumb = { label: string; href?: string };

export function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav class="breadcrumb" aria-label="Breadcrumb">
      {crumbs.map((crumb, index) => (
        <span key={crumb.label} class="contents">
          {index > 0 && <ChevronRight size={14} aria-hidden="true" />}
          {crumb.href ? <a href={crumb.href}>{crumb.label}</a> : <span aria-current="page">{crumb.label}</span>}
        </span>
      ))}
    </nav>
  );
}
