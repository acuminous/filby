import { ChevronLeft, ChevronRight } from 'lucide-preact';

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
    <div class="foot">
      <span>
        {first}–{last} of {total}
      </span>
      <span class="spacer" />
      <label>
        Page size
        <input class="input input-xs w-16" type="number" min={1} max={paging.max} value={size ?? ''} placeholder="all" onChange={changeSize} />
        {paging.max && <span>max {paging.max}</span>}
      </label>
      <div class="join">
        <button type="button" class="btn btn-xs btn-ghost join-item" disabled={!prev} onClick={() => onPage(page - 1)}>
          <ChevronLeft size={14} aria-hidden="true" />
          Previous
        </button>
        <span class="btn btn-xs btn-ghost join-item no-animation pointer-events-none">page {page}</span>
        <button type="button" class="btn btn-xs btn-ghost join-item" disabled={!next} onClick={() => onPage(page + 1)}>
          Next
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
