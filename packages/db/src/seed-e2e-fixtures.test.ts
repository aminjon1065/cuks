import { describe, expect, it } from 'vitest';
import { mapIncidentTimes } from './seed-e2e-fixtures';

describe('mapIncidentTimes', () => {
  it('keeps occurrence before reporting across repeated seed anchors', () => {
    for (const anchor of [Date.UTC(2026, 6, 14), Date.UTC(2026, 6, 21)]) {
      for (let index = 0; index < 12; index++) {
        const times = mapIncidentTimes(anchor, index);
        expect(times.occurredAt.getTime()).toBeLessThan(times.reportedAt.getTime());
      }
    }
  });
});
