import { useLocation, useRoute } from 'preact-iso';

import { ApiError, getChangeLog, getDocuments, getOpenApi } from '../api';
import { Breadcrumb } from '../components/Breadcrumb';
import { DocumentTable, inferColumns } from '../components/DocumentTable';
import { Filters } from '../components/Filters';
import { Paging } from '../components/Paging';
import { ErrorMessage, Loading } from '../components/Status';
import { formatDateTime } from '../format';
import { useEscape, useQuery, useResource } from '../hooks';
import { changeSetsPath, documentsPath, parseVersion, projectionsPath } from '../routes';
import { type ProjectionSchema, describeProjection } from '../schema';
import type { ChangeSet, Page } from '../types';

export function Documents() {
  const { params } = useRoute();
  const { route } = useLocation();
  const query = useQuery();
  const name = params.name ?? '';
  const version = parseVersion(params.version ?? '') ?? Number.NaN;
  const changeSetId = Number(params.id);
  useEscape(changeSetsPath(name, version));

  const context = useResource(() => loadContext(name, version, changeSetId), `${name}/${version}/${changeSetId}`);
  const page = useResource(() => getDocuments(name, version, changeSetId, query), `${name}/${version}/${changeSetId}?${query}`);

  const navigate = (next: URLSearchParams) => route(documentsPath(name, version, changeSetId, next));
  const applyFilters = (filters: URLSearchParams) => {
    const pageSize = query.get('pageSize');
    if (pageSize) filters.set('pageSize', pageSize);
    navigate(filters);
  };
  const changePage = (number: number) => {
    const next = new URLSearchParams(query);
    if (number > 1) next.set('page', String(number));
    else next.delete('page');
    navigate(next);
  };
  const changeSize = (size: number | undefined) => {
    const next = new URLSearchParams(query);
    next.delete('page');
    if (size) next.set('pageSize', String(size));
    else next.delete('pageSize');
    navigate(next);
  };

  return (
    <>
      <Breadcrumb crumbs={[{ label: 'Projections', href: projectionsPath() }, { label: `${name} v${params.version}`, href: changeSetsPath(name, version) }, { label: `Change set ${params.id}` }]} />
      {context.status === 'loading' && <Loading />}
      {context.status === 'error' && <ErrorMessage error={context.error} />}
      {context.status === 'ready' && (
        <>
          <Header name={name} version={version} changeSet={context.data.changeSet} page={page} />
          {context.data.schema.filters.length > 0 && <Filters filters={context.data.schema.filters} query={query} onSubmit={applyFilters} />}
          {page.status === 'loading' && <Loading />}
          {page.status === 'error' && <ErrorMessage error={page.error} />}
          {page.status === 'ready' && <Results schema={context.data.schema} page={page.data} query={query} onPage={changePage} onSize={changeSize} />}
        </>
      )}
    </>
  );
}

type Context = { schema: ProjectionSchema; changeSet: ChangeSet | undefined };

async function loadContext(name: string, version: number, changeSetId: number): Promise<Context> {
  const [document, changeLog] = await Promise.all([getOpenApi(), getChangeLog(name, version)]);
  const schema = describeProjection(document, name, version);
  if (!schema) throw new ApiError(404, `Projection '${name} v${version}' is not described by the OpenAPI document`);
  return { schema, changeSet: changeLog.find(({ id }) => id === changeSetId) };
}

function Header({ name, version, changeSet, page }: { name: string; version: number; changeSet: ChangeSet | undefined; page: ReturnType<typeof useResource<Page>> }) {
  return (
    <header class="toolbar">
      <h1>
        {name} <span class="version">v{version}</span>
      </h1>
      {changeSet ? (
        <span class="change-set">
          change set <code>{changeSet.id}</code> effective{' '}
          <time dateTime={changeSet.effective} title={changeSet.effective}>
            {formatDateTime(changeSet.effective)}
          </time>{' '}
          <q>{changeSet.description}</q>
        </span>
      ) : (
        <span class="change-set">change set not in this projection's change log</span>
      )}
      {page.status === 'ready' && <span class="count">{page.data.total === 1 ? '1 document' : `${page.data.total} documents`}</span>}
    </header>
  );
}

type ResultsProps = { schema: ProjectionSchema; page: Page; query: URLSearchParams; onPage: (page: number) => void; onSize: (size: number | undefined) => void };

function Results({ schema, page, query, onPage, onSize }: ResultsProps) {
  const columns = schema.columns ?? inferColumns(page.documents);
  const number = Number(query.get('page') ?? 1);
  const size = query.has('pageSize') ? Number(query.get('pageSize')) : schema.paging?.size;
  return (
    <>
      {schema.paging && <Paging paging={schema.paging} page={number} size={size} count={page.documents.length} total={page.total} prev={Boolean(page.prev)} next={Boolean(page.next)} onPage={onPage} onSize={onSize} />}
      {page.documents.length === 0 ? <p class="empty">No documents</p> : <DocumentTable columns={columns} documents={page.documents} />}
    </>
  );
}
