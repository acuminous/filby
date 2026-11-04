import { useSignal } from '@preact/signals';
import { useRoute } from 'preact-iso';

import { ApiError, changeLogUrl, getChangeLog } from '../api';
import { Breadcrumb } from '../components/Breadcrumb';
import { JsonBody, ViewToggle } from '../components/Json';
import { PageHeader } from '../components/PageHeader';
import { Empty, ErrorMessage, Loading } from '../components/Status';
import { formatDateTime, plural, toDateTimeLocal } from '../format';
import { useEscape, useResource, useView } from '../hooks';
import { resolveChangeSet } from '../resolveChangeSet';
import { documentsPath, parseVersion, projectionsPath } from '../routes';
import type { ChangeSet } from '../types';
import type { View } from '../views';

export function ChangeSets() {
  const { params } = useRoute();
  const name = params.name ?? '';
  const version = parseVersion(params.version ?? '');
  useEscape(projectionsPath());
  const [view, setView] = useView('change-sets');
  const resource = useResource(() => (version === undefined ? Promise.reject(new ApiError(404, `No route for ${location.pathname}`)) : getChangeLog(name, version)), `${name}/${version}`);
  return (
    <>
      <Breadcrumb crumbs={[{ label: 'Projections', href: projectionsPath() }, { label: `${name} ${params.version}` }]} />
      {resource.status === 'loading' && (
        <>
          <PageHeader name={name} version={version} />
          <Loading />
        </>
      )}
      {resource.status === 'error' && (
        <>
          <PageHeader name={name} version={version} />
          <ErrorMessage error={resource.error} />
        </>
      )}
      {resource.status === 'ready' && version !== undefined && <Timeline name={name} version={version} changeSets={resource.data} view={view} onView={setView} />}
    </>
  );
}

type TimelineProps = { name: string; version: number; changeSets: ChangeSet[]; view: View; onView: (view: View) => void };

function Timeline({ name, version, changeSets, view, onView }: TimelineProps) {
  const asOf = useSignal(toDateTimeLocal(new Date()));
  const now = new Date();
  const current = resolveChangeSet(changeSets, now);
  const instant = new Date(asOf.value);
  const resolved = Number.isNaN(instant.getTime()) ? undefined : resolveChangeSet(changeSets, instant);
  const ordered = [...changeSets].sort((a, b) => Date.parse(b.effective) - Date.parse(a.effective) || b.id - a.id);
  return (
    <>
      <PageHeader name={name} version={version} description={plural(changeSets.length, 'change set')}>
        {view === 'timeline' && (
          <label class="as-of">
            As of
            <input class="input input-sm w-52" type="datetime-local" value={asOf.value} onInput={(event) => (asOf.value = (event.currentTarget as HTMLInputElement).value)} />
            <span class="muted">{resolved ? `change set ${resolved.id}` : 'no change set in force'}</span>
          </label>
        )}
        <ViewToggle
          views={[
            ['timeline', 'Timeline'],
            ['json', 'JSON'],
          ]}
          value={view}
          onChange={onView}
        />
      </PageHeader>
      {view === 'json' ? (
        <div class="panel">
          <JsonBody url={changeLogUrl(name, version)} body={changeSets} />
        </div>
      ) : changeSets.length === 0 ? (
        <Empty>No change sets</Empty>
      ) : (
        <ol class="history">
          {ordered.map((changeSet) => {
            const future = Date.parse(changeSet.effective) > now.getTime();
            const asOf = changeSet === resolved && changeSet !== current;
            const classes = [changeSet === current && 'live', asOf && 'resolved', future && 'future'].filter(Boolean).join(' ');
            return (
              <li key={changeSet.id} class={classes || undefined}>
                <a href={documentsPath(name, version, changeSet.id)} aria-current={changeSet === current ? 'true' : undefined}>
                  <span class="dot" aria-hidden="true" />
                  <span class="when">
                    <time dateTime={changeSet.effective} title={changeSet.effective}>
                      {formatDateTime(changeSet.effective)}
                    </time>
                  </span>
                  <span class="what">
                    <span class="id">#{changeSet.id}</span>
                    {changeSet.description}
                    {changeSet === current && <span class="badge badge-sm badge-success badge-soft">live</span>}
                    {future && <span class="badge badge-sm badge-warning badge-soft">not yet live</span>}
                    {asOf && <span class="sr-only">as of</span>}
                  </span>
                  <span class="meta">
                    modified{' '}
                    <time dateTime={changeSet.lastModified} title={changeSet.lastModified}>
                      {formatDateTime(changeSet.lastModified)}
                    </time>
                    {' · '}
                    <code>{changeSet.entityTag}</code>
                  </span>
                </a>
                {changeSet.reissuedFrom !== undefined && (
                  <p class="reissued">
                    Re-issues <a href={documentsPath(name, version, changeSet.reissuedFrom)}>change set {changeSet.reissuedFrom}</a>
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
