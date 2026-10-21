import { useLocation, useRoute } from 'preact-iso';

import { ApiError, getChangeLog, getDocuments, getOpenApi } from '../api';
import { Breadcrumb } from '../components/Breadcrumb';
import { DocumentTable } from '../components/DocumentTable';
import { Filters } from '../components/Filters';
import { PageHeader } from '../components/PageHeader';
import { Paging } from '../components/Paging';
import { Empty, ErrorMessage, Loading } from '../components/Status';
import { formatDateTime, plural } from '../format';
import { type Resource, useEscape, useQuery, useResource } from '../hooks';
import { changeSetsPath, documentsPath, parseVersion, projectionsPath } from '../routes';
import { type ProjectionSchema, describeProjection, inferColumns } from '../schema';
import type { ChangeSet, Page } from '../types';

export function Documents() {
  const { params } = useRoute();
  const { route } = useLocation();
  const query = useQuery();
  const name = params.name ?? '';
  const version = parseVersion(params.version ?? '') ?? Number.NaN;
  const changeSetId = Number(params.id);
  useEscape(changeSetsPath(name, version));

  const context = useResource(() => loadContext(name, version), `${name}/${version}/${changeSetId}`);
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
  const changeChangeSet = (id: number) => route(documentsPath(name, version, id, query));

  return (
    <>
      <Breadcrumb crumbs={[{ label: 'Projections', href: projectionsPath() }, { label: `${name} ${params.version}`, href: changeSetsPath(name, version) }, { label: `Change set ${params.id}` }]} />
      {context.status === 'loading' && (
        <>
          <PageHeader name={name} version={version} />
          <Loading />
        </>
      )}
      {context.status === 'error' && (
        <>
          <PageHeader name={name} version={version} />
          <ErrorMessage error={context.error} />
        </>
      )}
      {context.status === 'ready' && (
        <>
          <Header name={name} version={version} changeSetId={changeSetId} changeLog={context.data.changeLog} page={page} onChangeSet={changeChangeSet} />
          {context.data.schema.filters.length > 0 && <Filters filters={context.data.schema.filters} query={query} onSubmit={applyFilters} />}
          {page.status === 'loading' && <Loading />}
          {page.status === 'error' && <ErrorMessage error={page.error} />}
          {page.status === 'ready' && <Results schema={context.data.schema} page={page.data} query={query} onPage={changePage} onSize={changeSize} />}
        </>
      )}
    </>
  );
}

type Context = { schema: ProjectionSchema; changeLog: ChangeSet[] };

async function loadContext(name: string, version: number): Promise<Context> {
  const [document, changeLog] = await Promise.all([getOpenApi(), getChangeLog(name, version)]);
  const schema = describeProjection(document, name, version);
  if (!schema) throw new ApiError(404, `Projection '${name} v${version}' is not described by the OpenAPI document`);
  return { schema, changeLog };
}

type HeaderProps = { name: string; version: number; changeSetId: number; changeLog: ChangeSet[]; page: Resource<Page>; onChangeSet: (id: number) => void };

function Header({ name, version, changeSetId, changeLog, page, onChangeSet }: HeaderProps) {
  const changeSet = changeLog.find(({ id }) => id === changeSetId);
  const ordered = [...changeLog].sort((a, b) => Date.parse(b.effective) - Date.parse(a.effective) || b.id - a.id);
  const description = changeSet ? (
    <>
      Effective{' '}
      <time dateTime={changeSet.effective} title={changeSet.effective}>
        {formatDateTime(changeSet.effective)}
      </time>
      {page.status === 'ready' && ` · ${plural(page.data.total, 'document')}`}
    </>
  ) : (
    "change set not in this projection's change log"
  );
  return (
    <PageHeader name={name} version={version}>
      <label class="as-of">
        Change set
        <select class="select select-sm w-72" value={changeSet ? String(changeSetId) : ''} onChange={(event) => onChangeSet(Number((event.currentTarget as HTMLSelectElement).value))}>
          {!changeSet && <option value="">{changeSetId}</option>}
          {ordered.map((entry) => (
            <option key={entry.id} value={String(entry.id)}>
              #{entry.id} {entry.description}
            </option>
          ))}
        </select>
      </label>
      <span class="muted">{description}</span>
    </PageHeader>
  );
}

type ResultsProps = { schema: ProjectionSchema; page: Page; query: URLSearchParams; onPage: (page: number) => void; onSize: (size: number | undefined) => void };

function Results({ schema, page, query, onPage, onSize }: ResultsProps) {
  const columns = schema.columns ?? inferColumns(page.documents);
  const number = Number(query.get('page') ?? 1);
  const size = query.has('pageSize') ? Number(query.get('pageSize')) : schema.paging?.size;
  if (page.documents.length === 0 && !schema.paging) return <Empty>No documents</Empty>;
  return (
    <div class="panel">
      {page.documents.length === 0 ? <Empty>No documents</Empty> : <DocumentTable columns={columns} documents={page.documents} />}
      {schema.paging && <Paging paging={schema.paging} page={number} size={size} count={page.documents.length} total={page.total} prev={Boolean(page.prev)} next={Boolean(page.next)} onPage={onPage} onSize={onSize} />}
    </div>
  );
}
