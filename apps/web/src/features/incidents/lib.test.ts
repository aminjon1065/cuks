import { describe, expect, it } from 'vitest';
import { dushanbeDateTimeToIso, dushanbeDayIso } from './lib';

describe('incident registry Dushanbe dates', () => {
  it('converts a datetime-local value as Asia/Dushanbe rather than browser local time', () => {
    expect(dushanbeDateTimeToIso('2026-07-14T09:30')).toBe('2026-07-14T04:30:00.000Z');
  });

  it('builds the inclusive local end of a date filter', () => {
    expect(dushanbeDayIso('2026-07-14', true)).toBe('2026-07-14T18:59:00.000Z');
  });
});
