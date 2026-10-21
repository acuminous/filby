import { useSignal } from '@preact/signals';
import { useRoute } from 'preact-iso';

import { ApiError, getChangeLog } from '../api';
import { Breadcrumb } from '../components/Breadcrumb';
import { LinkRow } from '../components/LinkRow';
import { ErrorMessage, Loading } from '../components/Status';
import { formatDateTime, toDateTimeLocal } from '../format';
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
      <Breadcrumb crumbs={[{ label: 'Projections', href: projectionsPath() }, { label: `${name} v${params.version}` }]} />
      {resource.status === 'loading' && <Loading />}
      {resource.status === 'error' && <ErrorMessage error={resource.error} />}
      {resource.status === 'ready' && version !== undefined && <ChangeSetTable name={name} version={version} changeSets={resource.data} />}
    </>
  );
}

function ChangeSetTable({ name, version, changeSets }: { name: string; version: number; changeSets: ChangeSet[] }) {
  const asOf = useSignal(toDateTimeLocal(new Date()));
  const now = new Date();
  const current = resolveChangeSet(changeSets, now);
  const instant = new Date(asOf.value);
  const resolved = Number.isNaN(instant.getTime()) ? undefined : resolveChangeSet(changeSets, instant);
  const ordered = [...changeSets].sort((a, b) => Date.parse(b.effective) - Date.parse(a.effective) || b.id - a.id);
  return (
    <>
      <header class="toolbar">
        <h1>
          {name} <span class="version">v{version}</span>
        </h1>
        <span class="count">{changeSets.length === 1 ? '1 change set' : `${changeSets.length} change sets`}</span>
        <label class="as-of">
          As of
          <input type="datetime-local" value={asOf.value} onInput={(event) => (asOf.value = (event.currentTarget as HTMLInputElement).value)} />
          <span class="hint">{resolved ? `change set ${resolved.id}` : 'no change set in force'}</span>
        </label>
      </header>
      {changeSets.length === 0 ? (
        <p class="empty">No change sets</p>
      ) : (
        <table class="change-sets">
          <thead>
            <tr>
              <th>Id</th>
              <th>Effective</th>
              <th>Description</th>
              <th>Last modified</th>
              <th>Entity tag</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((changeSet) => (
              <LinkRow key={changeSet.id} href={documentsPath(name, version, changeSet.id)} class={changeSet === resolved ? 'resolved' : undefined} selected={changeSet === resolved}>
                <td class="id">
                  <code>{changeSet.id}</code>
                </td>
                <td>
                  <time dateTime={changeSet.effective} title={changeSet.effective}>
                    {formatDateTime(changeSet.effective)}
                  </time>
                </td>
                <td>{changeSet.description}</td>
                <td>
                  <time dateTime={changeSet.lastModified} title={changeSet.lastModified}>
                    {formatDateTime(changeSet.lastModified)}
                  </time>
                </td>
                <td>
                  <code>{changeSet.entityTag}</code>
                </td>
                <td class="status">
                  {changeSet === current && <span class="badge live">live</span>}
                  {Date.parse(changeSet.effective) > now.getTime() && <span class="badge future">not yet live</span>}
                  {changeSet === resolved && <span class="badge as-of">as of</span>}
                </td>
              </LinkRow>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
