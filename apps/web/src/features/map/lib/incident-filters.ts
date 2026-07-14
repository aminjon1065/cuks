import { DISPLAY_TIMEZONE, type IncidentStatus } from '@cuks/shared';

/** Dushanbe is UTC+05 year-round (no DST). Keeping the conversion explicit
 * avoids interpreting `<input type=date>` through the browser's local zone. */
const DUSHANBE_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface IncidentFilterState {
  typeCode: string;
  status: IncidentStatus | '';
  regionId: string;
  dateFrom: string;
  dateTo: string;
  /** Inclusive local date up to which playback reveals incidents. */
  cursorDate: string;
}

function parseCalendarDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`Invalid calendar date: ${value}`);
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, day!));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month! - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`Invalid calendar date: ${value}`);
  }
  return parsed;
}

function formatCalendarDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Current YYYY-MM-DD in the mandated display timezone. */
export function todayInDushanbe(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DISPLAY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

export function addCalendarDays(value: string, days: number): string {
  const date = parseCalendarDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatCalendarDate(date);
}

export function calendarDaysBetween(from: string, to: string): number {
  return Math.round((parseCalendarDate(to).getTime() - parseCalendarDate(from).getTime()) / DAY_MS);
}

export function formatCalendarDateRu(value: string): string {
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}

/** UTC epoch seconds for 00:00 of a Dushanbe calendar date. */
export function dushanbeDayStartEpoch(value: string): number {
  return Math.floor((parseCalendarDate(value).getTime() - DUSHANBE_OFFSET_MS) / 1000);
}

export function defaultIncidentFilters(now: Date = new Date()): IncidentFilterState {
  const dateTo = todayInDushanbe(now);
  return {
    typeCode: '',
    status: '',
    regionId: '',
    dateFrom: addCalendarDays(dateTo, -29),
    dateTo,
    cursorDate: dateTo,
  };
}

/** Deterministic Martin query string. `to` is exclusive, so the selected cursor
 * day is included in full. The tile token is added later by transformRequest. */
export function buildIncidentTileQuery(filters: IncidentFilterState): string {
  const params = new URLSearchParams();
  if (filters.typeCode) params.set('type', filters.typeCode);
  if (filters.status) params.set('status', filters.status);
  if (filters.regionId) params.set('region', filters.regionId);
  params.set('from', String(dushanbeDayStartEpoch(filters.dateFrom)));
  params.set('to', String(dushanbeDayStartEpoch(addCalendarDays(filters.cursorDate, 1))));
  return params.toString();
}
