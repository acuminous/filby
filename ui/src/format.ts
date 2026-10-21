export function formatDateTime(iso: string, locale = navigator.language) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', ...(date.getSeconds() ? { second: '2-digit' } : {}) };
  return new Intl.DateTimeFormat(locale, options).format(date);
}

export function timeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function toDateTimeLocal(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}
