import { describe, expect, it } from 'vitest';
import { classifyTaskDeadline, taskDueBucket } from './index';

// Fixed "now" at 11:00 Asia/Dushanbe (06:00Z) so due dates at 06:00Z share the Dushanbe day.
const NOW = new Date('2026-07-15T06:00:00.000Z');
const at = (date: string) => `${date}T06:00:00.000Z`;

describe('classifyTaskDeadline', () => {
  it('reminds one day before and on the due day only', () => {
    expect(classifyTaskDeadline(at('2026-07-17'), NOW).reminder).toBeNull(); // 2 days — nothing
    expect(classifyTaskDeadline(at('2026-07-16'), NOW).reminder).toBe('due_soon');
    expect(classifyTaskDeadline(at('2026-07-15'), NOW).reminder).toBe('due_today');
    expect(classifyTaskDeadline(at('2026-07-14'), NOW).reminder).toBeNull(); // overdue, not a reminder
  });

  it('marks overdue once past the due day', () => {
    expect(classifyTaskDeadline(at('2026-07-15'), NOW).overdue).toBe(false);
    expect(classifyTaskDeadline(at('2026-07-14'), NOW).overdue).toBe(true);
  });
});

describe('taskDueBucket', () => {
  it('groups by proximity in Dushanbe days', () => {
    expect(taskDueBucket(null, NOW)).toBe('none');
    expect(taskDueBucket(at('2026-07-14'), NOW)).toBe('overdue');
    expect(taskDueBucket(at('2026-07-15'), NOW)).toBe('today');
    expect(taskDueBucket(at('2026-07-16'), NOW)).toBe('week');
    expect(taskDueBucket(at('2026-07-22'), NOW)).toBe('week'); // exactly 7 days
    expect(taskDueBucket(at('2026-07-23'), NOW)).toBe('later'); // 8 days
  });
});
