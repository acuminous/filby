import { ListFilter } from 'lucide-preact';

import type { Filter } from '../schema';

type Props = { filters: Filter[]; query: URLSearchParams; onSubmit: (query: URLSearchParams) => void };

export function Filters({ filters, query, onSubmit }: Props) {
  const submit = (event: Event) => {
    event.preventDefault();
    onSubmit(read(filters, new FormData(event.currentTarget as HTMLFormElement)));
  };
  const clear = () => onSubmit(new URLSearchParams());
  return (
    <form class="toolbar" key={query.toString()} onSubmit={submit}>
      <span class="muted" style="align-self: center; margin-bottom: 0.25rem">
        <ListFilter size={16} aria-hidden="true" />
      </span>
      {filters.map((filter) => (
        <Field key={filter.name} filter={filter} query={query} />
      ))}
      <div class="actions">
        <button type="submit" class="btn btn-sm btn-primary">
          Apply
        </button>
        <button type="button" class="btn btn-sm btn-ghost" onClick={clear}>
          Clear
        </button>
      </div>
    </form>
  );
}

function Field({ filter, query }: { filter: Filter; query: URLSearchParams }) {
  if (filter.kind === 'range') {
    return (
      <fieldset class="field">
        <legend>{filter.name}</legend>
        <div class="range">
          <label>
            from
            <input class="input input-sm w-28" name={filter.from} defaultValue={query.get(filter.from) ?? ''} />
          </label>
          <label>
            to
            <input class="input input-sm w-28" name={filter.to} defaultValue={query.get(filter.to) ?? ''} />
          </label>
        </div>
      </fieldset>
    );
  }
  const list = filter.values && `${filter.name}-values`;
  const value = filter.kind === 'list' ? query.getAll(filter.name).join(', ') : (query.get(filter.name) ?? '');
  return (
    <label class="field">
      <span>
        {filter.name}
        {filter.kind === 'list' && ' (comma separated)'}
      </span>
      <input class="input input-sm w-44" name={filter.name} defaultValue={value} list={list} />
      {list && <datalist id={list}>{filter.values?.map((option) => <option key={option} value={option} />)}</datalist>}
    </label>
  );
}

function read(filters: Filter[], data: FormData) {
  const query = new URLSearchParams();
  for (const filter of filters) {
    if (filter.kind === 'range') {
      for (const name of [filter.from, filter.to]) {
        const value = text(data.get(name));
        if (value) query.set(name, value);
      }
    } else if (filter.kind === 'list') {
      for (const value of text(data.get(filter.name)).split(',')) {
        if (value.trim()) query.append(filter.name, value.trim());
      }
    } else {
      const value = text(data.get(filter.name));
      if (value) query.set(filter.name, value);
    }
  }
  return query;
}

function text(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value.trim() : '';
}
