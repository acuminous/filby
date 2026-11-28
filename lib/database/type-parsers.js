import { types } from 'pg';

const ENUM_ARRAY_TYPES = 'SELECT t.typarray FROM pg_type t WHERE t.typname IN (SELECT DISTINCT name FROM fby_enum)';

const parseTextArray = types.getTypeParser(1009, 'text');

const LOCAL_DATE_PARSERS = new Map([
  [1082, parseDate],
  [1114, parseTimestamp],
  [1182, parseTextArray],
  [1115, parseTimestampArray],
]);

function parseDate(text) {
  return text;
}

function parseTimestamp(text) {
  return text.replace(' ', 'T');
}

function parseTimestampArray(text) {
  return parseTextArray(text).map((value) => (value === null ? null : parseTimestamp(value)));
}

function registerEnumArrayParsers(typeOverrides, rows) {
  for (const { typarray } of rows) typeOverrides.setTypeParser(typarray, parseTextArray);
}

export { ENUM_ARRAY_TYPES, LOCAL_DATE_PARSERS, registerEnumArrayParsers };
