export function formatDateTime(iso: string, locale = navigator.language) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: date.getSeconds() ? 'medium' : 'short' }).format(date);
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
