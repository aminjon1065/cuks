const DT = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Asia/Dushanbe',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Format a UTC ISO instant in Asia/Dushanbe (CLAUDE.md: display TZ). */
export function formatDateTime(iso: string): string {
  return DT.format(new Date(iso));
}

/** Unit a duration is worth printing in; the words themselves live in i18n. */
export type DurationUnit = 'ms' | 'sec' | 'min';

/**
 * Split a duration into a number and a unit key.
 *
 * The scheduled sweeps span four orders of magnitude — a retention pass over an empty day is
 * milliseconds, an audit-maintenance run is minutes — so a single fixed unit would print either
 * «0 мин» or «2 400 000 мс». One decimal is kept: the operator needs to notice 40 s → 4 мин, not
 * to time the run.
 */
export function durationParts(ms: number): { unit: DurationUnit; value: number } {
  if (ms < 1000) return { unit: 'ms', value: Math.round(ms) };
  if (ms < 60_000) return { unit: 'sec', value: Math.round(ms / 100) / 10 };
  return { unit: 'min', value: Math.round(ms / 6_000) / 10 };
}

function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV string from rows (header from the first row's keys). */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0] ?? {});
  const lines = [headers.join(';')];
  for (const row of rows) lines.push(headers.map((h) => csvCell(row[h])).join(';'));
  return lines.join('\n');
}

/** Trigger a client-side CSV download. */
export function downloadCsv(filename: string, csv: string): void {
  // Prepend a UTF-8 BOM so Excel opens Cyrillic CSVs correctly.
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
