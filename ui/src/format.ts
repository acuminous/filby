export function formatDateTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const parts = [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join('-');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return `${parts} ${time}${date.getSeconds() ? `:${pad(date.getSeconds())}` : ''}`;
}

export function toDateTimeLocal(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}
