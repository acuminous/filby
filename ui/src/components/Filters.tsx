import type { Filter } from '../schema';

type Props = { filters: Filter[]; query: URLSearchParams; onSubmit: (query: URLSearchParams) => void };

export function Filters({ filters, query, onSubmit }: Props) {
  const submit = (event: Event) => {
    event.preventDefault();
    onSubmit(read(filters, new FormData(event.currentTarget as HTMLFormElement)));
  };
  const clear = () => onSubmit(new URLSearchParams());
  return (
    <form class="filters" key={query.toString()} onSubmit={submit}>
      {filters.map((filter) => (
        <Field key={filter.name} filter={filter} query={query} />
      ))}
      <div class="actions">
        <button type="submit">Apply</button>
        <button type="button" class="secondary" onClick={clear}>
          Clear
        </button>
      </div>
    </form>
  );
}

function Field({ filter, query }: { filter: Filter; query: URLSearchParams }) {
  const list = filter.kind === 'range' ? undefined : filter.values && `${filter.name}-values`;
  const options = list && (
    <datalist id={list}>
      {filter.kind !== 'range' && filter.values?.map((value) => <option key={value} value={value} />)}
    </datalist>
  );
  if (filter.kind === 'range') {
    return (
      <fieldset class="range">
        <legend>{filter.name}</legend>
        <label>
          from
          <input name={filter.from} defaultValue={query.get(filter.from) ?? ''} />
        </label>
        <label>
          to
          <input name={filter.to} defaultValue={query.get(filter.to) ?? ''} />
        </label>
      </fieldset>
    );
  }
  const value = filter.kind === 'list' ? query.getAll(filter.name).join(', ') : (query.get(filter.name) ?? '');
  return (
    <label>
      {filter.name}
      {filter.kind === 'list' && <span class="hint">comma separated</span>}
      <input name={filter.name} defaultValue={value} list={list} />
      {options}
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
