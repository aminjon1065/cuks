import { describe, expect, it } from 'vitest';
import { classifyDeadline, deadlineDaysLeft, deadlineSeverity } from './index';

// Fixed "now" at 11:00 Asia/Dushanbe (06:00Z) so due dates at 06:00Z fall on the same
// Dushanbe calendar day as their UTC date.
const NOW = new Date('2026-07-15T06:00:00.000Z');
const at = (date: string) => `${date}T06:00:00.000Z`;

describe('deadlineDaysLeft (Asia/Dushanbe days)', () => {
  it('counts whole local days, negative when overdue', () => {
    expect(deadlineDaysLeft(at('2026-07-18'), NOW)).toBe(3);
    expect(deadlineDaysLeft(at('2026-07-15'), NOW)).toBe(0);
    expect(deadlineDaysLeft(at('2026-07-14'), NOW)).toBe(-1);
  });

  it('buckets by the Dushanbe day, not the UTC day', () => {
    // 2026-07-15T20:00Z is 2026-07-16 01:00 in Dushanbe (UTC+5) — one day out.
    expect(deadlineDaysLeft('2026-07-15T20:00:00.000Z', NOW)).toBe(1);
  });
});

describe('deadlineSeverity', () => {
  it('is normal beyond 3 days, warning within 3, overdue when past', () => {
    expect(deadlineSeverity(at('2026-07-20'), NOW)).toBe('normal');
    expect(deadlineSeverity(at('2026-07-18'), NOW)).toBe('warning');
    expect(deadlineSeverity(at('2026-07-15'), NOW)).toBe('warning');
    expect(deadlineSeverity(at('2026-07-14'), NOW)).toBe('overdue');
    expect(deadlineSeverity(null, NOW)).toBe('normal');
  });
});

describe('classifyDeadline', () => {
  it('fires reminders only at 3, 1 and 0 days', () => {
    expect(classifyDeadline(at('2026-07-18'), NOW).reminder).toBe('due3');
    expect(classifyDeadline(at('2026-07-17'), NOW).reminder).toBeNull(); // 2 days — no reminder
    expect(classifyDeadline(at('2026-07-16'), NOW).reminder).toBe('due1');
    expect(classifyDeadline(at('2026-07-15'), NOW).reminder).toBe('due0');
    expect(classifyDeadline(at('2026-07-20'), NOW).reminder).toBeNull();
  });

  it('marks overdue daily and escalates past 5 days', () => {
    const oneDay = classifyDeadline(at('2026-07-14'), NOW);
    expect(oneDay).toMatchObject({ overdue: true, escalation: false, severity: 'overdue' });
    const sixDays = classifyDeadline(at('2026-07-09'), NOW);
    expect(sixDays).toMatchObject({ overdue: true, escalation: true });
    // Exactly 5 days overdue is not yet an escalation.
    expect(classifyDeadline(at('2026-07-10'), NOW).escalation).toBe(false);
  });
});
