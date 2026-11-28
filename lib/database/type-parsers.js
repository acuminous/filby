import { types } from 'pg';

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

export { LOCAL_DATE_PARSERS, registerEnumArrayParsers };
