import { DISPLAY_TIMEZONE, INCIDENT_STATUSES, type IncidentStatus } from '@cuks/shared';

const DUSHANBE_OFFSET_MS = 5 * 60 * 60 * 1000;

export const incidentStatusTone: Record<
  IncidentStatus,
  'neutral' | 'info' | 'warning' | 'success'
> = {
  reported: 'neutral',
  active: 'info',
  localized: 'warning',
  eliminated: 'success',
  closed: 'success',
};

/** `datetime-local` value in the mandated display time zone. */
export function dushanbeDateTimeLocal(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DISPLAY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

/** Interpret a local Dushanbe input independently of the browser's own zone. */
export function dushanbeDateTimeToIso(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid Dushanbe datetime: ${value}`);
  const [, year, month, day, hour, minute] = match;
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return new Date(utc - DUSHANBE_OFFSET_MS).toISOString();
}

export function dushanbeDayIso(value: string, endOfDay = false): string {
  return dushanbeDateTimeToIso(`${value}T${endOfDay ? '23:59' : '00:00'}`);
}

export function dushanbeDateFromIso(value: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DISPLAY_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU').format(value);
}

export function formatDamage(value: string | null): string | null {
  if (!value) return null;
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(Number(value));
}

export interface IncidentStatusEventMeta {
  fromStatus: IncidentStatus;
  toStatus: IncidentStatus;
  reason: string | null;
  rollback: boolean;
}

/** Narrow untrusted audit JSON before rendering it as a status transition. */
export function readIncidentStatusEventMeta(
  meta: Record<string, unknown> | null,
): IncidentStatusEventMeta | null {
  if (!meta) return null;
  const fromStatus = meta['fromStatus'];
  const toStatus = meta['toStatus'];
  if (
    typeof fromStatus !== 'string' ||
    typeof toStatus !== 'string' ||
    !(INCIDENT_STATUSES as readonly string[]).includes(fromStatus) ||
    !(INCIDENT_STATUSES as readonly string[]).includes(toStatus)
  ) {
    return null;
  }
  return {
    fromStatus: fromStatus as IncidentStatus,
    toStatus: toStatus as IncidentStatus,
    reason: typeof meta['reason'] === 'string' ? meta['reason'] : null,
    rollback: meta['rollback'] === true,
  };
}
