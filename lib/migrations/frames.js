import fs from 'node:fs';
import path from 'node:path';

import papaparse from 'papaparse';

import { canonicalise, v } from '../naming.js';

const CHUNK_SIZE = 1000;

function frameChunks(frame, options) {
  const rows = frame.source ? loadCsv(frame, options) : frame.data.map((data, index) => ({ action: frame.action, data, location: index }));
  const chunks = [];
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) chunks.push(toChunk(frame, rows.slice(i, i + CHUNK_SIZE)));
  return chunks;
}

function toChunk(frame, rows) {
  const fields = new Map();
  for (const key of rows.flatMap(({ data }) => Object.keys(data))) if (!fields.has(canonicalise(key))) fields.set(canonicalise(key), key);
  const prefix = frame.source ? `${frame.source}:` : `${frame.pointer}/data/`;
  return { fields: [...fields.keys()], given: [...fields.values()], rows: rows.map(({ action, data, location }) => ({ action: frameAction(action), data: canonicalKeys(frame, data), location })), prefix };
}

function canonicalKeys(frame, data) {
  const keys = new Map();
  for (const key of Object.keys(data)) {
    const other = keys.get(canonicalise(key));
    if (other !== undefined) throw new Error(`Frame for entity '${frame.entity} ${v(frame.version)}' cannot set both '${other}' and '${key}', because both become '${canonicalise(key)}'`);
    keys.set(canonicalise(key), key);
  }
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [canonicalise(key), value]));
}

function frameAction(action) {
  const canonicalAction = action.toUpperCase();
  return canonicalAction === 'POST' ? 'SET' : canonicalAction;
}

function loadCsv(frame, options) {
  const csvPath = path.resolve(options.data.directory, frame.source);
  const { rows, fields, errors } = parseCsv(csvPath);
  if (errors[0]) throw new Error(`Error parsing ${csvPath}:${errors[0].row} - ${errors[0].message}`);
  const actionColumn = fields.find((field) => canonicalise(field) === 'action');
  const hasActionColumn = actionColumn !== undefined;
  if (frame.action !== undefined && hasActionColumn) throw new Error(`Frame for entity '${frame.entity} ${v(frame.version)}' specifies action '${frame.action}' but ${csvPath} also has an action column`);
  if (frame.action === undefined && !hasActionColumn) throw new Error(`Frame for entity '${frame.entity} ${v(frame.version)}' does not specify an action and ${csvPath} has no action column`);
  if (frame.action !== undefined) return rows.map(({ data, row }) => ({ action: frame.action, data, location: row }));
  return rows.map(({ data: { [actionColumn]: action, ...data }, row }) => {
    if (action === null) throw new Error(`Error parsing ${csvPath}:${row} - Missing action`);
    return { action, data, location: row };
  });
}

function parseCsv(csvPath) {
  const source = fs.readFileSync(csvPath, 'utf8');
  const { data: records, errors } = papaparse.parse(source, {
    delimiter: path.extname(csvPath).toLowerCase() === '.tsv' ? '\t' : ',',
    dynamicTyping: false,
  });
  const [header = { values: [] }, ...body] = records.map((values, index) => ({ values, row: index + 1 })).filter(({ values }) => values.length > 1 || values[0] !== '');
  const fields = header.values;
  return {
    rows: body.map(({ values, row }) => ({ data: Object.fromEntries(fields.map((field, index) => [field, values[index] === '' ? null : values[index]])), row })),
    fields,
    errors: errors.map(({ message, row }) => ({ message, row: row + 1 })).concat(csvShapeErrors(header, body)),
  };
}

function csvShapeErrors(header, body) {
  const fields = header.values;
  const duplicate = fields.find((field, index) => fields.indexOf(field) !== index);
  const errors = duplicate === undefined ? [] : [{ message: `Duplicate column '${duplicate}'`, row: header.row }];
  for (const { values, row } of body) {
    if (values.length < fields.length) errors.push({ message: `Too few fields: expected ${fields.length} fields but parsed ${values.length}`, row });
    if (values.length > fields.length) errors.push({ message: `Too many fields: expected ${fields.length} fields but parsed ${values.length}`, row });
  }
  return errors;
}

export { frameChunks };
