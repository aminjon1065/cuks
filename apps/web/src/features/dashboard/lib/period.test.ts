import { describe, expect, it } from 'vitest';
import { periodWindow } from './period';

describe('periodWindow', () => {
  const now = new Date('2026-07-15T12:00:00.000Z');

  it('day is the 24 hours ending now', () => {
    const w = periodWindow('day', now);
    expect(w.to).toBe('2026-07-15T12:00:00.000Z');
    expect(w.from).toBe('2026-07-14T12:00:00.000Z');
  });

  it('week is the 7 days ending now', () => {
    expect(periodWindow('week', now).from).toBe('2026-07-08T12:00:00.000Z');
  });

  it('month is the 30 days ending now', () => {
    expect(periodWindow('month', now).from).toBe('2026-06-15T12:00:00.000Z');
  });
});
