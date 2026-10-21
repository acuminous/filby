import { Layers } from 'lucide-preact';
import { useLocation } from 'preact-iso';

import { getProjections } from '../api';
import { timeZone } from '../format';
import { useResource } from '../hooks';
import { changeSetsPath, projectionsPath } from '../routes';

export function Sidebar() {
  const { path } = useLocation();
  const resource = useResource(getProjections, 'projections');
  return (
    <aside class="sidebar">
      <a href={projectionsPath()} class="brand">
        <Layers size={18} strokeWidth={2.25} aria-hidden="true" />
        Filby
      </a>
      <div class="section">Projections</div>
      {resource.status === 'loading' && <div class="quiet">Loading…</div>}
      {resource.status === 'error' && <div class="quiet">Projections unavailable</div>}
      {resource.status === 'ready' && resource.data.length === 0 && <div class="quiet">None yet</div>}
      {resource.status === 'ready' && (
        <ul>
          {resource.data.map((projection) => {
            const href = changeSetsPath(projection.name, projection.version);
            return (
              <li key={href}>
                <a href={href} aria-current={path === href || path.startsWith(`${href}/`) ? 'true' : undefined}>
                  <span>{projection.name}</span>
                  <span class="version">v{projection.version}</span>
                </a>
              </li>
            );
          })}
        </ul>
      )}
      <div class="foot">Times are shown in {timeZone()}</div>
    </aside>
  );
}
