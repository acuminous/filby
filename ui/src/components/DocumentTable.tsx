import { Fragment } from 'preact';

import type { Column } from '../schema';
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
            {column.name} <span class="count">{documents.length}</span>
          </summary>
          {documents.length > 0 && <DocumentTable columns={column.columns ?? inferColumns(documents)} documents={documents} />}
        </details>
      </td>
    </tr>
  );
}

export function inferColumns(documents: Document[]): Column[] {
  const names = [...new Set(documents.flatMap((document) => Object.keys(document)))];
  return names.map((name) => {
    const values = documents.map((document) => document[name]).filter((value) => value !== null && value !== undefined);
    const nested = values.filter(Array.isArray).flat();
    if (values.length > 0 && values.every(Array.isArray) && nested.length > 0 && nested.every((item) => typeof item === 'object' && item !== null)) {
      return { name, kind: 'table', columns: inferColumns(nested as Document[]) };
    }
    if (values.length > 0 && values.every(Array.isArray)) return { name, kind: 'array' };
    return { name, kind: 'value' };
  });
}
