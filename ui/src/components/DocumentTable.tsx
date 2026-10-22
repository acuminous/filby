import { ChevronRight } from 'lucide-preact';
import { Fragment } from 'preact';

import { type Column, inferColumns } from '../schema';
import type { Document } from '../types';
import { Value } from './Value';

type Cell = { name: string; kind: Column['kind']; lookup?: string };

export function DocumentTable({ columns, documents }: { columns: Column[]; documents: Document[] }) {
  const scalars = columns.filter(({ kind }) => kind !== 'table');
  const nests = columns.filter(({ kind }) => kind === 'table');
  const cells = scalars.flatMap(flatten);
  return (
    <table class="documents">
      <thead>
        {scalars.some(({ kind }) => kind === 'lookup') && (
          <tr class="groups">
            {scalars.map((column) =>
              column.kind === 'lookup' ? (
                <th key={column.name} colSpan={column.columns?.length}>
                  {column.name}
                </th>
              ) : (
                <th key={column.name} />
              ),
            )}
          </tr>
        )}
        <tr>
          {cells.map((cell) => (
            <th key={key(cell)}>{cell.name}</th>
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
              <Nest key={nest.name} column={nest} rows={document[nest.name]} span={cells.length || 1} />
            ))}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

function Nest({ column, rows, span }: { column: Column; rows: unknown; span: number }) {
  const documents = Array.isArray(rows) ? (rows as Document[]) : [];
  return (
    <tr class="nest">
      <td colSpan={span}>
        <details open>
          <summary>
            <ChevronRight size={14} aria-hidden="true" />
            {column.name} <span class="badge badge-ghost badge-xs">{documents.length}</span>
          </summary>
          {documents.length > 0 && <DocumentTable columns={column.columns ?? inferColumns(documents)} documents={documents} />}
        </details>
      </td>
    </tr>
  );
}

function flatten(column: Column): Cell[] {
  if (column.kind !== 'lookup') return [column];
  return (column.columns ?? []).map(({ name, kind }) => ({ name, kind, lookup: column.name }));
}

function key({ name, lookup }: Cell) {
  return lookup ? `${lookup}.${name}` : name;
}

function read(document: Document, { name, lookup }: Cell) {
  if (!lookup) return document[name];
  const value = document[lookup];
  return value === null || value === undefined ? null : (value as Document)[name];
}
