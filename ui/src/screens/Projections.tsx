import { ChevronRight } from 'lucide-preact';

import { getOpenApi, getProjections } from '../api';
import { PageHeader } from '../components/PageHeader';
import { Empty, ErrorMessage, Loading } from '../components/Status';
import { useResource } from '../hooks';
import { changeSetsPath } from '../routes';
import { type Column, type Filter, describeProjection } from '../schema';
import type { OpenApi, Projection } from '../types';

const KINDS: Record<Filter['kind'], string> = { value: '', list: 'in', range: 'range' };

export function Projections() {
  const resource = useResource(() => Promise.all([getProjections(), getOpenApi()]), 'projections');
  return (
    <>
      <PageHeader name="Projections" description="The reference data this application serves" />
      {resource.status === 'loading' && <Loading />}
      {resource.status === 'error' && <ErrorMessage error={resource.error} />}
      {resource.status === 'ready' && <Catalog projections={resource.data[0]} document={resource.data[1]} />}
    </>
  );
}

function Catalog({ projections, document }: { projections: Projection[]; document: OpenApi }) {
  if (projections.length === 0) return <Empty>No projections</Empty>;
  return (
    <ul class="catalog">
      {projections.map((projection) => (
        <Entry key={`${projection.name} v${projection.version}`} projection={projection} document={document} />
      ))}
    </ul>
  );
}

function Entry({ projection, document }: { projection: Projection; document: OpenApi }) {
  const schema = describeProjection(document, projection.name, projection.version);
  return (
    <li>
      <a href={changeSetsPath(projection.name, projection.version)}>
        <div class="title">
          {projection.name}
          <span class="version">v{projection.version}</span>
          <ChevronRight size={18} aria-hidden="true" />
        </div>
        <div class="description">{projection.description}</div>
        <dl>
          <dt>Fields</dt>
          <dd>{schema?.columns ? chips(schema.columns.filter(({ kind }) => kind !== 'table' && kind !== 'lookup').map(({ name }) => name)) : <span class="null">function rows</span>}</dd>
          <dt>Parameters</dt>
          <dd>
            {schema?.filters.length ? (
              schema.filters.map((filter) => (
                <span class="chip" key={filter.name}>
                  {filter.name}
                  {KINDS[filter.kind] && <span class="kind">{KINDS[filter.kind]}</span>}
                </span>
              ))
            ) : (
              <span class="null">none</span>
            )}
          </dd>
          <dt>Nested</dt>
          <dd>{chips(nests(schema?.columns ?? []))}</dd>
          <dt>Lookups</dt>
          <dd>{chips(lookups(schema?.columns ?? []))}</dd>
          <dt>Paging</dt>
          <dd>{paging(schema?.paging)}</dd>
        </dl>
      </a>
    </li>
  );
}

function chips(names: string[]) {
  if (names.length === 0) return <span class="null">none</span>;
  return names.map((name) => (
    <span class="chip" key={name}>
      {name}
    </span>
  ));
}

function nests(columns: Column[], prefix = ''): string[] {
  return columns.filter(({ kind }) => kind === 'table').flatMap((column) => [`${prefix}${column.name}`, ...nests(column.columns ?? [], `${prefix}${column.name}.`)]);
}

function lookups(columns: Column[], prefix = ''): string[] {
  return columns.flatMap((column) => {
    if (column.kind === 'lookup') return [`${prefix}${column.name}`];
    if (column.kind === 'table') return lookups(column.columns ?? [], `${prefix}${column.name}.`);
    return [];
  });
}

function paging(schema: { size?: number; max?: number } | undefined) {
  if (!schema) return <span class="null">none</span>;
  if (!schema.size) return 'on request';
  return `${schema.size} per page${schema.max ? `, up to ${schema.max}` : ''}`;
}
