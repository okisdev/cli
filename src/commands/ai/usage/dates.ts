export const DATA_TIMEZONE = 'Asia/Shanghai';

const DAY_KEY_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: DATA_TIMEZONE });

export function dayKey(input: Date | string): string | null {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  return DAY_KEY_FORMAT.format(date);
}

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TRAILING_WHITESPACE = /^\s*$/;
const TIME_COMPONENT = /\d{1,2}:\d{2}/;

export function csvDay(value: string): string | null {
  const head = value.slice(0, 10);
  const rest = value.slice(10);
  if (BARE_DATE.test(head) && TRAILING_WHITESPACE.test(rest)) return head;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || !TIME_COMPONENT.test(value)) return null;

  return dayKey(parsed);
}

export function tzLabel(minutes: string): string {
  if (minutes === '480') return DATA_TIMEZONE;

  const total = Number(minutes);
  const sign = total < 0 ? '-' : '+';
  const hours = Math.floor(Math.abs(total) / 60);
  const mins = Math.abs(total) % 60;

  return mins === 0 ? `UTC${sign}${hours}` : `UTC${sign}${hours}:${String(mins).padStart(2, '0')}`;
}
