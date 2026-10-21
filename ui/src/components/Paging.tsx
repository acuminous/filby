import type { Paging as PagingSchema } from '../schema';

type Props = { paging: PagingSchema; page: number; size: number | undefined; count: number; total: number; prev: boolean; next: boolean; onPage: (page: number) => void; onSize: (size: number | undefined) => void };

export function Paging({ paging, page, size, count, total, prev, next, onPage, onSize }: Props) {
  const first = count === 0 ? 0 : (page - 1) * (size ?? 0) + 1;
  const last = count === 0 ? 0 : first + count - 1;
  const changeSize = (event: Event) => {
    const value = (event.currentTarget as HTMLInputElement).valueAsNumber;
    onSize(Number.isNaN(value) || value < 1 ? undefined : Math.min(value, paging.max ?? value));
  };
  return (
    <div class="paging">
      <span class="showing">
        {first}–{last} of {total}
      </span>
      <button type="button" class="secondary" disabled={!prev} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span class="page">page {page}</span>
      <button type="button" class="secondary" disabled={!next} onClick={() => onPage(page + 1)}>
        Next
      </button>
      <label>
        Page size
        <input type="number" min={1} max={paging.max} value={size ?? ''} placeholder="all" onChange={changeSize} />
        {paging.max && <span class="hint">max {paging.max}</span>}
      </label>
    </div>
  );
}
