import { ChevronsDownUp, ChevronsUpDown } from 'lucide-preact';
import { useLocation, useRoute } from 'preact-iso';

import { ApiError, documentsUrl, getChangeLog, getDocuments, getOpenApi } from '../api';
import { Breadcrumb } from '../components/Breadcrumb';
import { DocumentTable } from '../components/DocumentTable';
import { Filters } from '../components/Filters';
import { JsonBody, ViewToggle } from '../components/Json';
import { PageHeader } from '../components/PageHeader';
import { Paging } from '../components/Paging';
import { Empty, ErrorMessage, Loading } from '../components/Status';
import { formatDateTime, plural } from '../format';
import { type Resource, useEscape, useNests, useQuery, useResource, useView } from '../hooks';
import { type NestState, storageKey, withAll } from '../nests';
import { changeSetsPath, documentsPath, parseVersion, projectionsPath } from '../routes';
import { type ProjectionSchema, describeProjection, inferColumns, nests } from '../schema';
import type { ChangeSet, Page } from '../types';
import { type View, withoutView } from '../views';

export function Documents() {
  const { params } = useRoute();
  const { route } = useLocation();
  const query = useQuery();
  const apiQuery = withoutView(query);
  const name = params.name ?? '';
  const version = parseVersion(params.version ?? '') ?? Number.NaN;
  const changeSetId = Number(params.id);
  useEscape(changeSetsPath(name, version));
  const [nestState, setNests] = useNests(storageKey(name, version));
  const [view, setView] = useView('documents');

  const context = useResource(() => loadContext(name, version), `${name}/${version}/${changeSetId}`);
  const page = useResource(() => getDocuments(name, version, changeSetId, apiQuery), `${name}/${version}/${changeSetId}?${apiQuery}`);

  const navigate = (next: URLSearchParams) => route(documentsPath(name, version, changeSetId, next));
  const applyFilters = (filters: URLSearchParams) => {
    const pageSize = query.get('pageSize');
    if (pageSize) filters.set('pageSize', pageSize);
    if (view === 'json') filters.set('view', 'json');
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
          <Header name={name} version={version} changeSetId={changeSetId} changeLog={context.data.changeLog} query={query} page={page} view={view} onChangeSet={changeChangeSet} onView={setView} />
          {context.data.schema.filters.length > 0 && <Filters filters={context.data.schema.filters} query={apiQuery} onSubmit={applyFilters} />}
          {page.status === 'loading' && <Loading />}
          {page.status === 'error' && <ErrorMessage error={page.error} />}
          {page.status === 'ready' && <Results schema={context.data.schema} page={page.data} query={query} url={documentsUrl(name, version, changeSetId, apiQuery)} view={view} nests={nestState} onNests={setNests} onPage={changePage} onSize={changeSize} />}
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

type HeaderProps = { name: string; version: number; changeSetId: number; changeLog: ChangeSet[]; query: URLSearchParams; page: Resource<Page>; view: View; onChangeSet: (id: number) => void; onView: (view: View) => void };

function Header({ name, version, changeSetId, changeLog, query, page, view, onChangeSet, onView }: HeaderProps) {
  const changeSet = changeLog.find(({ id }) => id === changeSetId);
  const reissue = changeSet ? undefined : changeLog.find(({ reissuedFrom }) => reissuedFrom === changeSetId);
  const ordered = [...changeLog].sort((a, b) => Date.parse(b.effective) - Date.parse(a.effective) || b.id - a.id);
  const total = page.status === 'ready' && ` · ${plural(page.data.total, 'document')}`;
  const link = (id: number) => <a href={documentsPath(name, version, id, query)}>change set {id}</a>;
  const description = changeSet ? (
    <>
      Effective{' '}
      <time dateTime={changeSet.effective} title={changeSet.effective}>
        {formatDateTime(changeSet.effective)}
      </time>
      {changeSet.reissuedFrom !== undefined && <> · re-issues {link(changeSet.reissuedFrom)}</>}
      {total}
    </>
  ) : reissue ? (
    <>
      re-issued as {link(reissue.id)} · documents as originally published{total}
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
              {entry.reissuedFrom !== undefined && ` (re-issues #${entry.reissuedFrom})`}
            </option>
          ))}
        </select>
      </label>
      <span class="muted">{description}</span>
      <ViewToggle
        views={[
          ['ui', 'UI'],
          ['json', 'JSON'],
        ]}
        value={view}
        onChange={onView}
      />
    </PageHeader>
  );
}

type ResultsProps = { schema: ProjectionSchema; page: Page; query: URLSearchParams; url: string; view: View; nests: NestState; onNests: (state: NestState) => void; onPage: (page: number) => void; onSize: (size: number | undefined) => void };

function Results({ schema, page, query, url, view, nests: state, onNests, onPage, onSize }: ResultsProps) {
  const columns = schema.columns ?? inferColumns(page.documents);
  const number = Number(query.get('page') ?? 1);
  const size = query.has('pageSize') ? Number(query.get('pageSize')) : schema.paging?.size;
  const paging = schema.paging && <Paging paging={schema.paging} page={number} size={size} count={page.documents.length} total={page.total} prev={Boolean(page.prev)} next={Boolean(page.next)} onPage={onPage} onSize={onSize} />;
  if (view === 'json') {
    return (
      <div class="panel">
        <JsonBody url={url} body={page.documents} />
        {paging}
      </div>
    );
  }
  if (page.documents.length === 0 && !schema.paging) return <Empty>No documents</Empty>;
  const paths = page.documents.length > 0 ? nests(columns) : [];
  return (
    <div class="panel">
      {paths.length > 0 && (
        <div class="head">
          <span>Nests</span>
          {paths.map((path) => (
            <button type="button" key={path} class={`btn btn-xs btn-ghost${state[path] ? ' btn-active' : ''}`} aria-pressed={Boolean(state[path])} title={`${state[path] ? 'Collapse' : 'Expand'} all ${path}`} onClick={() => onNests(withAll(state, path, !state[path]))}>
              {state[path] ? <ChevronsDownUp size={14} aria-hidden="true" /> : <ChevronsUpDown size={14} aria-hidden="true" />}
              {path}
            </button>
          ))}
        </div>
      )}
      {page.documents.length === 0 ? <Empty>No documents</Empty> : <DocumentTable columns={columns} documents={page.documents} nests={state} onNests={onNests} />}
      {paging}
    </div>
  );
}
