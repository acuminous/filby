import { formatDateTime } from '../format';
import type { Column } from '../schema';

export function Value({ kind, value }: { kind: Column['kind']; value: unknown }) {
  if (value === null || value === undefined) return <span class="null">null</span>;
  if (kind === 'date-time' && typeof value === 'string') {
    return (
      <time dateTime={value} title={value}>
        {formatDateTime(value)}
      </time>
    );
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span class="null">empty</span>;
    return (
      <span class="array">
        {value.map((item, index) => (
          <span key={String(index)}>
            {index > 0 && ', '}
            <Value kind="value" value={item} />
          </span>
        ))}
      </span>
    );
  }
  if (typeof value === 'boolean') return <code>{String(value)}</code>;
  if (typeof value === 'object') return <code>{JSON.stringify(value)}</code>;
  return <>{String(value)}</>;
}
