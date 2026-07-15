import { describe, expect, it } from 'vitest';
import { statsPeriodWindow } from './period';

describe('statsPeriodWindow', () => {
  const now = new Date('2026-07-15T12:00:00.000Z');

  it('month is the 30 days ending now', () => {
    expect(statsPeriodWindow('month', now).from).toBe('2026-06-15T12:00:00.000Z');
  });

  it('quarter is the 90 days ending now', () => {
    expect(statsPeriodWindow('quarter', now).from).toBe('2026-04-16T12:00:00.000Z');
  });

  it('year is the 365 days ending now', () => {
    const w = statsPeriodWindow('year', now);
    expect(w.from).toBe('2025-07-15T12:00:00.000Z');
    expect(w.to).toBe('2026-07-15T12:00:00.000Z');
  });
});
