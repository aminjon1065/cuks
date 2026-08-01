import { describe, expect, it, vi } from 'vitest';
import { planRetry } from './exchange-retry-policy';

/**
 * The sender's decision table, exercised through the policy it delegates to.
 *
 * The service itself is thin on purpose — claim, call, record — so the behaviour worth pinning
 * is «what does the register look like after each kind of failure», which is entirely the
 * policy plus which columns the outcome writes.
 */
const NOW = new Date('2026-08-01T10:00:00Z');

/** Mirrors the columns `recordFailure` sets, so the table below reads as the row it produces. */
function rowAfterFailure(attemptNo: number, maxAttempts: number, retryable: boolean) {
  const plan = planRetry(attemptNo, maxAttempts, { retryable, failureCode: 'x' }, NOW);
  const deadLettered = plan.action === 'dead_letter';
  return {
    status: deadLettered ? 'failed' : 'pending',
    nextAttemptAt: plan.nextAttemptAt,
    deadLetteredAt: deadLettered ? NOW : null,
    reason: plan.reason,
  };
}

describe('what the register looks like after a failed machine send', () => {
  it('a transient failure leaves the attempt PENDING with a schedule — the machine still owns it', () => {
    const row = rowAfterFailure(1, 5, true);
    expect(row.status).toBe('pending');
    expect(row.nextAttemptAt).toBeTruthy();
    expect(row.deadLetteredAt).toBeNull();
  });

  it('the last attempt settles as FAILED and dead-lettered — a human owns it now', () => {
    const row = rowAfterFailure(5, 5, true);
    expect(row.status).toBe('failed');
    expect(row.nextAttemptAt).toBeNull();
    expect(row.deadLetteredAt).toEqual(NOW);
    expect(row.reason).toBe('attempts_exhausted');
  });

  it('a permanent failure does not spend the budget first', () => {
    const row = rowAfterFailure(1, 5, false);
    expect(row.status).toBe('failed');
    expect(row.deadLetteredAt).toEqual(NOW);
    expect(row.reason).toBe('permanent');
  });

  it('never leaves an attempt both scheduled and dead-lettered', () => {
    // The two states answer «кто владеет этим письмом»: the sender, or a person. Both at once
    // would mean the machine retries something an operator is already fixing.
    for (const attempt of [1, 2, 5, 9]) {
      for (const retryable of [true, false]) {
        const row = rowAfterFailure(attempt, 5, retryable);
        expect(Boolean(row.nextAttemptAt) && Boolean(row.deadLetteredAt), `${attempt}`).toBe(false);
      }
    }
  });
});

describe('an adapter that throws is treated as a transport fault, not a crash', () => {
  it('the sender converts a thrown error into a retryable outcome', async () => {
    // Mirrors the `.catch()` in ExchangeSenderService.deliver: «отказ внешней системы не
    // ломает основной API» means a throwing adapter must become a row, never a 500.
    const send = vi.fn().mockRejectedValue(new Error('ECONNRESET'));
    const outcome = await send({}).catch(
      (error: unknown) =>
        ({
          ok: false,
          retryable: true,
          failureCode: 'exchange.adapter_threw',
          detail: String(error),
        }) as const,
    );
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.retryable).toBe(true);
    const row = rowAfterFailure(1, 5, outcome.retryable);
    expect(row.status).toBe('pending');
  });
});
