import { ChevronRight } from 'lucide-preact';
import { Fragment } from 'preact';
import { useRef } from 'preact/hooks';

import { type NestState, isOpen, withRow } from '../nests';
import { type Column, inferColumns } from '../schema';
import type { Document } from '../types';
import { Value } from './Value';

type Cell = { name: string; kind: Column['kind']; lookup?: string; label: string; joins?: string };

type Props = { columns: Column[]; documents: Document[]; nests: NestState; onNests: (state: NestState) => void; path?: string; row?: string };

export function DocumentTable({ columns, documents, nests: state, onNests, path = '', row = '' }: Props) {
  const scalars = columns.filter(({ kind }) => kind !== 'table');
  const nests = columns.filter(({ kind }) => kind === 'table');
  const cells = flatten(scalars);
  return (
    <table class="documents">
      <thead>
        <tr>
          {cells.map((cell) => (
            <th key={key(cell)} class={cell.joins && 'joined'} title={cell.joins}>
              {cell.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {documents.map((document, index) => (
          <Fragment key={String(index)}>
            <tr>
              {cells.map((cell) => (
                <td key={key(cell)}>
                  <Value kind={cell.kind} value={read(document, cell)} />
                </td>
              ))}
            </tr>
            {nests.map((nest) => (
              <Nest key={nest.name} column={nest} rows={document[nest.name]} span={cells.length || 1} path={path ? `${path}.${nest.name}` : nest.name} row={row ? `${row}.${index}` : String(index)} nests={state} onNests={onNests} />
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

type NestProps = { column: Column; rows: unknown; span: number; path: string; row: string; nests: NestState; onNests: (state: NestState) => void };

function Nest({ column, rows, span, path, row, nests, onNests }: NestProps) {
  const documents = Array.isArray(rows) ? (rows as Document[]) : [];
  const open = isOpen(nests, path, row);
  const current = useRef(open);
  current.current = open;
  const toggle = (event: Event) => {
    const toggled = (event.currentTarget as HTMLDetailsElement).open;
    if (toggled !== current.current) onNests(withRow(nests, path, row, toggled));
  };
  return (
    <tr class="nest">
      <td colSpan={span}>
        <details open={open} onToggle={toggle}>
          <summary>
            <ChevronRight size={14} aria-hidden="true" />
            {column.name} <span class="badge badge-ghost badge-xs">{documents.length}</span>
          </summary>
          {open && documents.length > 0 && <DocumentTable columns={column.columns ?? inferColumns(documents)} documents={documents} nests={nests} onNests={onNests} path={path} row={row} />}
        </details>
      </td>
    </tr>
  );
}

function flatten(scalars: Column[]): Cell[] {
  const fields = scalars.filter(({ kind }) => kind !== 'lookup').map(({ name }) => name);
  const names = scalars.flatMap((column) => (column.kind === 'lookup' ? (column.columns ?? []).map(({ name }) => name) : [column.name]));
  const joins = new Map<string, string>();
  for (const lookup of scalars.filter(({ kind }) => kind === 'lookup')) {
    for (const [field, parent] of Object.entries(lookup.on ?? {})) {
      const joined = fields.includes(parent) ? parent : lookup.columns?.some(({ name }) => name === field) ? `${lookup.name}.${field}` : undefined;
      if (joined) joins.set(joined, `joins ${lookup.name} on ${field}`);
    }
  }
  return scalars.flatMap((column): Cell[] => {
    if (column.kind !== 'lookup') return [{ name: column.name, kind: column.kind, label: column.name, joins: joins.get(column.name) }];
    return (column.columns ?? []).map(({ name, kind }) => {
      const clashes = names.filter((candidate) => candidate === name).length > 1;
      return { name, kind, lookup: column.name, label: clashes ? `${column.name}.${name}` : name, joins: joins.get(`${column.name}.${name}`) };
    });
  });
}

function key({ name, lookup }: Cell) {
  return lookup ? `${lookup}.${name}` : name;
}

function read(document: Document, { name, lookup }: Cell) {
  if (!lookup) return document[name];
  const value = document[lookup];
  return value === null || value === undefined ? null : (value as Document)[name];
}
