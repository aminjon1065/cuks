/**
 * Locale-aware formatters shared across features (CLAUDE.md §2: display TZ is
 * Asia/Dushanbe, UI language Russian). Kept here — not in `@cuks/ui` — because
 * the design system stays locale-free; presentational components take already
 * formatted strings.
 */

const DT = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Asia/Dushanbe',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Format a UTC ISO instant in Asia/Dushanbe. */
export function formatDateTime(iso: string): string {
  return DT.format(new Date(iso));
}

const D = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Asia/Dushanbe',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** Format a UTC ISO instant as a date only (no time) in Asia/Dushanbe — for
 *  date-only values (e.g. a deadline the user set with `<input type="date">`),
 *  which would otherwise render a spurious midnight-UTC → 05:00 local time. */
export function formatDate(iso: string): string {
  return D.format(new Date(iso));
}

const RTF = new Intl.RelativeTimeFormat('ru-RU', { numeric: 'auto' });

/** Relative time from now — "5 минут назад" (docs/06 §5, for feeds). Past a week
 *  it falls back to the absolute date. `now` is injectable for tests. */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const diffSec = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return RTF.format(diffSec, 'second');
  if (abs < 3600) return RTF.format(Math.round(diffSec / 60), 'minute');
  if (abs < 86_400) return RTF.format(Math.round(diffSec / 3600), 'hour');
  if (abs < 7 * 86_400) return RTF.format(Math.round(diffSec / 86_400), 'day');
  return formatDateTime(iso);
}

/** Human-readable byte size (ru-RU grouping) — "12,5 МБ". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  const units = ['КБ', 'МБ', 'ГБ', 'ТБ'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded.toLocaleString('ru-RU')} ${units[i]}`;
}
