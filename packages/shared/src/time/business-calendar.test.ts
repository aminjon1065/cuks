import { describe, expect, it } from 'vitest';
import {
  addMonthsUtc,
  DUSHANBE_UTC_OFFSET_MS,
  businessDateParts,
  businessYear,
  dushanbeDayNumber,
} from './index';

describe('businessDateParts (Asia/Dushanbe civil date)', () => {
  it('keeps a mid-day instant on its own UTC date', () => {
    expect(businessDateParts(new Date('2026-07-15T06:00:00.000Z'))).toEqual({
      year: 2026,
      month: 7,
      day: 15,
    });
  });

  it('rolls over to the next local day from 19:00Z', () => {
    // 19:00Z is midnight in Dushanbe (UTC+5) — the local date is already tomorrow.
    expect(businessDateParts(new Date('2026-07-15T18:59:59.999Z'))).toMatchObject({ day: 15 });
    expect(businessDateParts(new Date('2026-07-15T19:00:00.000Z'))).toMatchObject({
      month: 7,
      day: 16,
    });
  });

  it('crosses the year boundary five hours before UTC does', () => {
    expect(businessDateParts(new Date('2026-12-31T18:59:59.999Z'))).toEqual({
      year: 2026,
      month: 12,
      day: 31,
    });
    expect(businessDateParts(new Date('2026-12-31T19:30:00.000Z'))).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
  });

  it('crosses the month boundary five hours before UTC does', () => {
    expect(businessDateParts(new Date('2026-03-31T18:59:59.999Z'))).toMatchObject({
      month: 3,
      day: 31,
    });
    expect(businessDateParts(new Date('2026-03-31T19:00:00.000Z'))).toMatchObject({
      month: 4,
      day: 1,
    });
  });

  it('handles a leap day and the following non-leap February', () => {
    // 2024 is a leap year: 29 February exists and only rolls into March at 19:00Z.
    expect(businessDateParts(new Date('2024-02-29T10:00:00.000Z'))).toEqual({
      year: 2024,
      month: 2,
      day: 29,
    });
    expect(businessDateParts(new Date('2024-02-29T19:00:00.000Z'))).toEqual({
      year: 2024,
      month: 3,
      day: 1,
    });
    // 2027 is not: 28 February is the last day of the month.
    expect(businessDateParts(new Date('2027-02-28T19:00:00.000Z'))).toEqual({
      year: 2027,
      month: 3,
      day: 1,
    });
  });

  it('exposes the year on its own', () => {
    expect(businessYear(new Date('2026-12-31T19:30:00.000Z'))).toBe(2027);
    expect(businessYear(new Date('2026-12-31T18:30:00.000Z'))).toBe(2026);
  });
});

describe('dushanbeDayNumber fast path', () => {
  it('is the fixed UTC+5 offset', () => {
    expect(DUSHANBE_UTC_OFFSET_MS).toBe(5 * 60 * 60 * 1000);
  });

  it('increments exactly at the local midnight', () => {
    const before = dushanbeDayNumber(Date.parse('2026-07-15T18:59:59.999Z'));
    const after = dushanbeDayNumber(Date.parse('2026-07-15T19:00:00.000Z'));
    expect(after - before).toBe(1);
  });

  it('agrees with the tz-database civil date across boundaries and leap days', () => {
    // Guards the fast path against drifting from Intl if Tajikistan ever changes its
    // offset: both must name the same local day for every sampled instant.
    const samples = [
      '2024-02-29T10:00:00.000Z',
      '2024-02-29T19:00:00.000Z',
      '2026-03-31T18:59:59.999Z',
      '2026-03-31T19:00:00.000Z',
      '2026-07-15T06:00:00.000Z',
      '2026-12-31T18:59:59.999Z',
      '2026-12-31T19:30:00.000Z',
      '2027-02-28T19:00:00.000Z',
    ];
    for (const iso of samples) {
      const instant = new Date(iso);
      const { year, month, day } = businessDateParts(instant);
      // Day number of the same civil date computed from the Intl parts, as UTC midnight.
      const fromParts = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
      expect(dushanbeDayNumber(instant.getTime())).toBe(fromParts);
    }
  });
});

describe('addMonthsUtc', () => {
  it('adds whole months', () => {
    expect(addMonthsUtc(new Date('2026-01-15T10:00:00Z'), 60).toISOString()).toBe(
      '2031-01-15T10:00:00.000Z',
    );
    expect(addMonthsUtc(new Date('2026-11-30T00:00:00Z'), 2).toISOString()).toBe(
      '2027-01-30T00:00:00.000Z',
    );
  });

  it('clamps to the last day when the target month is shorter', () => {
    // A naive setMonth rolls 31 января + 1 месяц into 3 марта, quietly handing a retention
    // term extra days every time the arithmetic crosses a short month.
    expect(addMonthsUtc(new Date('2026-01-31T00:00:00Z'), 1).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
    expect(addMonthsUtc(new Date('2026-08-31T00:00:00Z'), 1).toISOString()).toBe(
      '2026-09-30T00:00:00.000Z',
    );
  });

  it('handles a leap February', () => {
    expect(addMonthsUtc(new Date('2028-01-31T00:00:00Z'), 1).toISOString()).toBe(
      '2028-02-29T00:00:00.000Z',
    );
  });

  it('keeps the time of day, in UTC', () => {
    expect(addMonthsUtc(new Date('2026-03-10T23:45:12.500Z'), 12).toISOString()).toBe(
      '2027-03-10T23:45:12.500Z',
    );
  });
});
