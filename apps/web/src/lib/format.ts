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
