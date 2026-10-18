import { formatCount } from '../../../../src/overview/contract.js';

export function relativeTime(value: string, generatedAt: string): string {
  const elapsed = Math.max(0, Date.parse(generatedAt) - Date.parse(value));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** Formats the incident's own clock without relying on the viewer's device timezone. */
export function formatAbsolute(value: string | null): string {
  if (!value) return 'Unknown';
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return 'Unknown';
  const [, year, month, day, hour, minute, zone, sign, offsetHour, offsetMinute] = match;
  const localDate = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const date = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(localDate);
  const time = `${hour}:${minute}`;
  const zoneLabel = zone === 'Z' ? 'UTC' : `UTC${sign}${Number(offsetHour)}${Number(offsetMinute) === 0 ? '' : `:${offsetMinute}`}`;
  return `${date}, ${time} (${zoneLabel})`;
}

export function displayNumber(value: number | null): string {
  return formatCount(value);
}

export function priorityChip(priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'): { label: string; className: string } {
  const labels = { CRITICAL: ['Critical', 'critical'], HIGH: ['High', 'high'], MEDIUM: ['Medium', 'medium'], LOW: ['Low', 'low'], UNKNOWN: ['Unknown', 'unknown'] } as const;
  const [label, className] = labels[priority];
  return { label, className };
}
