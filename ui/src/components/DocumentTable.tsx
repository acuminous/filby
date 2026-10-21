import { ChevronRight } from 'lucide-preact';
import { Fragment } from 'preact';

import { type Column, inferColumns } from '../schema';
import type { Document } from '../types';
import { Value } from './Value';

export function DocumentTable({ columns, documents }: { columns: Column[]; documents: Document[] }) {
  const scalars = columns.filter(({ kind }) => kind !== 'table');
  const nests = columns.filter(({ kind }) => kind === 'table');
  return (
    <table class="documents">
      <thead>
        <tr>{scalars.map(({ name }) => <th key={name}>{name}</th>)}</tr>
      </thead>
      <tbody>
        {documents.map((document, index) => (
          <Fragment key={String(index)}>
            <tr>
              {scalars.map(({ name, kind }) => (
                <td key={name}>
                  <Value kind={kind} value={document[name]} />
                </td>
              ))}
            </tr>
            {nests.map((nest) => (
              <Nest key={nest.name} column={nest} rows={document[nest.name]} span={scalars.length || 1} />
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
