import { useSignal } from '@preact/signals';
import { useRoute } from 'preact-iso';

import { ApiError, getChangeLog } from '../api';
import { Breadcrumb } from '../components/Breadcrumb';
import { PageHeader } from '../components/PageHeader';
import { Empty, ErrorMessage, Loading } from '../components/Status';
import { formatDateTime, plural, toDateTimeLocal } from '../format';
import { useEscape, useResource } from '../hooks';
import { resolveChangeSet } from '../resolveChangeSet';
import { documentsPath, parseVersion, projectionsPath } from '../routes';
import type { ChangeSet } from '../types';

export function ChangeSets() {
  const { params } = useRoute();
  const name = params.name ?? '';
  const version = parseVersion(params.version ?? '');
  useEscape(projectionsPath());
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
      {resource.status === 'ready' && version !== undefined && <Timeline name={name} version={version} changeSets={resource.data} />}
    </>
  );
}

function Timeline({ name, version, changeSets }: { name: string; version: number; changeSets: ChangeSet[] }) {
  const asOf = useSignal(toDateTimeLocal(new Date()));
  const now = new Date();
  const current = resolveChangeSet(changeSets, now);
  const instant = new Date(asOf.value);
  const resolved = Number.isNaN(instant.getTime()) ? undefined : resolveChangeSet(changeSets, instant);
  const ordered = [...changeSets].sort((a, b) => Date.parse(b.effective) - Date.parse(a.effective) || b.id - a.id);
  return (
    <>
      <PageHeader name={name} version={version} description={plural(changeSets.length, 'change set')}>
        <label class="as-of">
          As of
          <input class="input input-sm w-52" type="datetime-local" value={asOf.value} onInput={(event) => (asOf.value = (event.currentTarget as HTMLInputElement).value)} />
          <span class="muted">{resolved ? `change set ${resolved.id}` : 'no change set in force'}</span>
        </label>
      </PageHeader>
      {changeSets.length === 0 ? (
        <Empty>No change sets</Empty>
      ) : (
        <ol class="history">
          {ordered.map((changeSet) => {
            const future = Date.parse(changeSet.effective) > now.getTime();
            const classes = [changeSet === current && 'live', changeSet === resolved && 'resolved', future && 'future'].filter(Boolean).join(' ');
            return (
              <li key={changeSet.id} class={classes || undefined}>
                <a href={documentsPath(name, version, changeSet.id)} aria-current={changeSet === resolved ? 'true' : undefined}>
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
                    {changeSet === resolved && changeSet !== current && <span class="badge badge-sm badge-primary badge-soft">as of</span>}
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
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}
