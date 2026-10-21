import { getOpenApi, getProjections } from '../api';
import { Breadcrumb } from '../components/Breadcrumb';
import { LinkRow } from '../components/LinkRow';
import { ErrorMessage, Loading } from '../components/Status';
import { useResource } from '../hooks';
import { changeSetsPath } from '../routes';
import { type Column, type Filter, describeProjection } from '../schema';
import type { OpenApi, Projection } from '../types';

const KINDS: Record<Filter['kind'], string> = { value: '', list: 'in', range: 'range' };

export function Projections() {
  const resource = useResource(() => Promise.all([getProjections(), getOpenApi()]), 'projections');
  return (
    <>
      <Breadcrumb crumbs={[{ label: 'Projections' }]} />
      {resource.status === 'loading' && <Loading />}
      {resource.status === 'error' && <ErrorMessage error={resource.error} />}
      {resource.status === 'ready' && <ProjectionTable projections={resource.data[0]} document={resource.data[1]} />}
    </>
  );
}

function ProjectionTable({ projections, document }: { projections: Projection[]; document: OpenApi }) {
  if (projections.length === 0) return <p class="empty">No projections</p>;
  return (
    <table class="projections">
      <thead>
        <tr>
          <th>Name</th>
          <th>Version</th>
          <th>Description</th>
          <th>Fields</th>
          <th>Parameters</th>
          <th>Nested</th>
          <th>Paging</th>
        </tr>
      </thead>
      <tbody>
        {projections.map((projection) => (
          <ProjectionRow key={`${projection.name} v${projection.version}`} projection={projection} document={document} />
        ))}
      </tbody>
    </table>
  );
}

function ProjectionRow({ projection, document }: { projection: Projection; document: OpenApi }) {
  const schema = describeProjection(document, projection.name, projection.version);
  return (
    <LinkRow href={changeSetsPath(projection.name, projection.version)}>
      <td class="name">{projection.name}</td>
      <td class="version">v{projection.version}</td>
      <td>{projection.description ?? <span class="null">null</span>}</td>
      <td>{schema?.columns ? codes(schema.columns.filter(({ kind }) => kind !== 'table').map(({ name }) => name)) : <span class="null">function rows</span>}</td>
      <td>
        {schema?.filters.length ? (
          schema.filters.map((filter) => (
            <span class="parameter" key={filter.name}>
              <code>{filter.name}</code>
              {KINDS[filter.kind] && <span class="kind">{KINDS[filter.kind]}</span>}
            </span>
          ))
        ) : (
          <span class="null">none</span>
        )}
      </td>
      <td>{codes(nests(schema?.columns ?? []))}</td>
      <td>{paging(schema?.paging)}</td>
    </LinkRow>
  );
}

function codes(names: string[]) {
  if (names.length === 0) return <span class="null">none</span>;
  return names.map((name) => (
    <code class="field" key={name}>
      {name}
    </code>
  ));
}

function nests(columns: Column[], prefix = ''): string[] {
  return columns.filter(({ kind }) => kind === 'table').flatMap((column) => [`${prefix}${column.name}`, ...nests(column.columns ?? [], `${prefix}${column.name}.`)]);
}

function paging(schema: { size?: number; max?: number } | undefined) {
  if (!schema) return <span class="null">none</span>;
  if (!schema.size) return 'on request';
  return `${schema.size}${schema.max ? ` (max ${schema.max})` : ''}`;
}
