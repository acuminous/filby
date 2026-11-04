import { Info, ListFilter } from 'lucide-preact';

import { type Filter, label } from '../schema';

type Props = { filters: Filter[]; query: URLSearchParams; onSubmit: (query: URLSearchParams) => void };

export function Filters({ filters, query, onSubmit }: Props) {
  const submit = (event: Event) => {
    event.preventDefault();
    onSubmit(read(filters, new FormData(event.currentTarget as HTMLFormElement)));
  };
  const clear = () => onSubmit(new URLSearchParams());
  const nested = filters.filter((filter) => filter.nested);
  return (
    <form class="toolbar" key={query.toString()} onSubmit={submit}>
      <span class="muted" style="align-self: flex-end; margin-bottom: 1.75rem">
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
      {nested.length > 0 && <Note filters={nested} />}
    </form>
  );
}

function Field({ filter, query }: { filter: Filter; query: URLSearchParams }) {
  const caption = `${filter.name}-match`;
  if (filter.kind === 'range') {
    return (
      <fieldset class="field">
        <legend>{filter.name}</legend>
        <div class="bounds">
          <label>
            from
            <input class="input input-sm w-28" name={filter.from} defaultValue={query.get(filter.from) ?? ''} aria-describedby={caption} />
          </label>
          <label>
            to
            <input class="input input-sm w-28" name={filter.to} defaultValue={query.get(filter.to) ?? ''} aria-describedby={caption} />
          </label>
        </div>
        <Caption id={caption} filter={filter} />
      </fieldset>
    );
  }
  const list = filter.values && `${filter.name}-values`;
  const value = filter.kind === 'list' ? query.getAll(filter.name).join(', ') : (query.get(filter.name) ?? '');
  return (
    <div class="field">
      <label>
        <span>
          {filter.name}
          {filter.kind === 'list' && ' (comma separated)'}
        </span>
        <input class="input input-sm w-44" name={filter.name} defaultValue={value} list={list} aria-describedby={caption} />
      </label>
      {list && <datalist id={list}>{filter.values?.map((option) => <option key={option} value={option} />)}</datalist>}
      <Caption id={caption} filter={filter} />
    </div>
  );
}

function Caption({ id, filter }: { id: string; filter: Filter }) {
  return (
    <small id={id} class="caption">
      {label(filter)}
    </small>
  );
}

// A parameter on a field inside a nest picks the documents that have a matching nested row; the documents still carry all their nested rows.
function Note({ filters }: { filters: Filter[] }) {
  const names = filters.map(({ name }) => name);
  const subject = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  const text = names.length === 1 ? ' filters on a nested field, so it selects which documents are returned and does not filter the nested rows inside them.' : ' filter on nested fields, so they select which documents are returned and do not filter the nested rows inside them.';
  return (
    <p class="note" role="note">
      <Info size={14} aria-hidden="true" />
      <span>
        {subject}
        {text}
      </span>
    </p>
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
