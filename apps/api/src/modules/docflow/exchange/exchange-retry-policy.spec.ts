import { describe, expect, it } from 'vitest';
import { backoffDelayMs, canOperatorRetry, planRetry } from './exchange-retry-policy';

const NOW = new Date('2026-08-01T10:00:00Z');
const transient = { retryable: true, failureCode: 'folder.write_failed' };
const permanent = { retryable: false, failureCode: 'folder.address_refused' };

describe('backoffDelayMs', () => {
  it('starts quick and doubles', () => {
    expect(backoffDelayMs(1)).toBe(30_000);
    expect(backoffDelayMs(2)).toBe(60_000);
    expect(backoffDelayMs(3)).toBe(120_000);
    expect(backoffDelayMs(4)).toBe(240_000);
  });

  it('stops at half an hour, however many attempts have gone by', () => {
    expect(backoffDelayMs(10)).toBe(30 * 60_000);
    expect(backoffDelayMs(1000)).toBe(30 * 60_000);
  });

  it('never returns a negative or zero delay for a nonsense attempt number', () => {
    expect(backoffDelayMs(0)).toBeGreaterThan(0);
    expect(backoffDelayMs(-5)).toBeGreaterThan(0);
  });
});

describe('planRetry', () => {
  it('schedules another attempt while the budget lasts', () => {
    const plan = planRetry(1, 5, transient, NOW);
    expect(plan.action).toBe('retry');
    expect(plan.reason).toBe('transient');
    expect(plan.nextAttemptAt?.toISOString()).toBe('2026-08-01T10:00:30.000Z');
  });

  it('dead-letters the last attempt instead of scheduling one nobody will run', () => {
    const plan = planRetry(5, 5, transient, NOW);
    expect(plan.action).toBe('dead_letter');
    expect(plan.reason).toBe('attempts_exhausted');
    expect(plan.nextAttemptAt).toBeNull();
  });

  it('dead-letters a permanent failure at once, whatever the budget says', () => {
    // A refused address does not become correct by being tried five times; spending the
    // budget on it only delays the moment somebody reads the error.
    const plan = planRetry(1, 5, permanent, NOW);
    expect(plan.action).toBe('dead_letter');
    expect(plan.reason).toBe('permanent');
  });

  it('honours a budget of one — the «try once» configuration', () => {
    expect(planRetry(1, 1, transient, NOW).action).toBe('dead_letter');
  });
});

describe('canOperatorRetry', () => {
  const base = { status: 'failed', deadLetteredAt: null, nextAttemptAt: null };

  it('lets an operator retry what the machine gave up on', () => {
    expect(canOperatorRetry({ ...base, deadLetteredAt: NOW })).toBe(true);
  });

  it('refuses while the sender still owns it — two senders on one letter deliver it twice', () => {
    expect(canOperatorRetry({ ...base, nextAttemptAt: NOW })).toBe(false);
  });

  it('refuses anything that is not a failed attempt', () => {
    for (const status of ['pending', 'sent', 'cancelled']) {
      expect(canOperatorRetry({ ...base, status, deadLetteredAt: NOW }), status).toBe(false);
    }
  });

  it('allows a manual failure with no schedule — the pre-stage-10 case', () => {
    expect(canOperatorRetry(base)).toBe(true);
  });
});
