import { describe, expect, it } from 'vitest';
import { dushanbeDayWindow } from './meetings.service';

/** The «today» window for the meetings list is the Asia/Dushanbe (UTC+5, no DST) calendar day. */
describe('dushanbeDayWindow', () => {
  it('brackets the Dushanbe calendar day of a mid-day instant', () => {
    // 2026-07-16T10:00Z is 15:00 in Dushanbe on 16 Jul → the day runs 15 Jul 19:00Z .. 16 Jul 19:00Z.
    const { start, end } = dushanbeDayWindow(new Date('2026-07-16T10:00:00Z'));
    expect(start.toISOString()).toBe('2026-07-15T19:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-16T19:00:00.000Z');
  });

  it('keeps a late-evening UTC instant in the correct (next) Dushanbe day', () => {
    // 2026-07-16T20:00Z is 01:00 on 17 Jul in Dushanbe → the day is 16 Jul 19:00Z .. 17 Jul 19:00Z.
    const { start, end } = dushanbeDayWindow(new Date('2026-07-16T20:00:00Z'));
    expect(start.toISOString()).toBe('2026-07-16T19:00:00.000Z');
    expect(end.toISOString()).toBe('2026-07-17T19:00:00.000Z');
  });

  it('produces a 24-hour window', () => {
    const { start, end } = dushanbeDayWindow(new Date('2026-01-01T00:00:00Z'));
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});
