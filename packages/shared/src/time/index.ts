/**
 * Business-calendar helpers (docs/04 §БД, CLAUDE.md §2): the database stores UTC
 * (`timestamptz`), but every *calendar* boundary the business cares about — the
 * registration year/month of a document number, the day a deadline falls on — is a
 * local Asia/Dushanbe boundary. Keeping the conversion in one place stops each
 * module from re-deriving it (and from silently using the UTC year, which is a
 * different year for five hours every 31 December).
 */

import { DISPLAY_TIMEZONE } from '../constants/index';

/**
 * Asia/Dushanbe has been a fixed UTC+5 with no DST since 1991. The constant is the
 * fast path for hot code (day bucketing over long lists); anything that needs the
 * civil *date* uses {@link businessDateParts}, which reads the runtime tz database
 * and therefore survives a future rule change. `business-calendar.test.ts` asserts
 * the two agree, so the fast path can never quietly drift from the tz database.
 */
export const DUSHANBE_UTC_OFFSET_MS = 5 * 60 * 60 * 1000;

const DAY_MS = 86_400_000;

/** The Asia/Dushanbe calendar day of a UTC instant, as a day number (floored). */
export function dushanbeDayNumber(ms: number): number {
  return Math.floor((ms + DUSHANBE_UTC_OFFSET_MS) / DAY_MS);
}

/** A civil date in the display timezone. `month` is 1-based (1 = January). */
export interface BusinessDateParts {
  year: number;
  month: number;
  day: number;
}

const civilDate = new Intl.DateTimeFormat('en-US', {
  timeZone: DISPLAY_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * The Asia/Dushanbe civil date of a UTC instant — the business year/month/day used
 * for registration numbering (docs/modules/11 §3). `2026-12-31T19:30:00Z` is already
 * 1 January 2027 in Dushanbe, so a document registered then belongs to the 2027 book.
 */
export function businessDateParts(instant: Date): BusinessDateParts {
  const parts = civilDate.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    return part ? Number(part.value) : Number.NaN;
  };
  return { year: read('year'), month: read('month'), day: read('day') };
}

/** The business (Asia/Dushanbe) calendar year of a UTC instant. */
export function businessYear(instant: Date): number {
  return businessDateParts(instant).year;
}

/**
 * Add whole months to an instant, clamping the day when the target month is shorter
 * (docs/modules/11 §12.12 — a retention term is stated in months).
 *
 * `31 января + 1 месяц` is the last day of February, not the third of March: a naive
 * `setMonth` rolls over into the next month, which would quietly hand a record an extra few
 * days of retention every time the arithmetic crossed a short month. The calculation is done
 * in UTC, where the deadline is stored; the Dushanbe calendar matters for what a *date* is
 * called, not for how many months lie between two instants.
 */
export function addMonthsUtc(instant: Date, months: number): Date {
  const year = instant.getUTCFullYear();
  const month = instant.getUTCMonth() + months;
  const day = instant.getUTCDate();
  // Day 0 of the following month is the last day of the target month.
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(day, lastDayOfTarget),
      instant.getUTCHours(),
      instant.getUTCMinutes(),
      instant.getUTCSeconds(),
      instant.getUTCMilliseconds(),
    ),
  );
}
