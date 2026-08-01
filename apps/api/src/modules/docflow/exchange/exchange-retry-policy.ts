/**
 * When a failed machine delivery is tried again, and when it stops being tried (plan этап 10
 * «retries, exponential backoff, dead-letter management»).
 *
 * Pure, because every rule here decides whether a letter eventually leaves the building — and
 * because the interesting cases (a permanent refusal, the last attempt, the clock) are all
 * easier to state as a table than to reproduce against a real transport.
 *
 * No numbers for any of this exist in the specs; the ones below are recorded in STATUS.md.
 */

/** The outcome of one attempt, as the sender sees it. */
export interface AttemptOutcome {
  retryable: boolean;
  failureCode: string;
}

export interface RetryPlan {
  /** `retry` schedules another attempt; `dead_letter` hands the attempt to a human. */
  action: 'retry' | 'dead_letter';
  /** When to try again — null when the attempt is dead-lettered. */
  nextAttemptAt: Date | null;
  /** Why, in one stable code, for the operator's list and for audit. */
  reason: 'transient' | 'permanent' | 'attempts_exhausted';
}

/**
 * Exponential with a ceiling: 30s, 1m, 2m, 4m … capped at 30 minutes.
 *
 * The first retry is quick because most transport failures are a moment long — a folder being
 * remounted, a service restarting — and a chancellery watching a letter sit in «ошибка» for
 * five minutes will start sending it by hand. The ceiling exists because past half an hour the
 * difference between waiting and being dead-lettered is only who is watching, and a human
 * should be.
 */
const BASE_DELAY_MS = 30_000;
const MAX_DELAY_MS = 30 * 60_000;

export function backoffDelayMs(attemptNo: number): number {
  // `attemptNo` is the attempt that just failed, so the first failure waits BASE.
  const exponent = Math.max(0, Math.min(attemptNo - 1, 20));
  return Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** exponent);
}

/**
 * Decide what happens after a failed attempt.
 *
 * A NON-retryable failure is dead-lettered immediately, whatever the attempt budget says: a
 * refused address does not become correct by being tried five times, and spending the budget
 * on it only delays the moment somebody reads the error.
 */
export function planRetry(
  attemptNo: number,
  maxAttempts: number,
  outcome: AttemptOutcome,
  now: Date,
): RetryPlan {
  if (!outcome.retryable) {
    return { action: 'dead_letter', nextAttemptAt: null, reason: 'permanent' };
  }
  if (attemptNo >= maxAttempts) {
    return { action: 'dead_letter', nextAttemptAt: null, reason: 'attempts_exhausted' };
  }
  return {
    action: 'retry',
    nextAttemptAt: new Date(now.getTime() + backoffDelayMs(attemptNo)),
    reason: 'transient',
  };
}

/**
 * Whether an operator's manual retry is allowed to open a new attempt.
 *
 * Deliberately permissive on a dead-lettered attempt — that is the whole point of the
 * dead-letter list («оператор видит ошибку и может безопасно повторить») — and refused while
 * the machine still owns it, because two senders racing on one letter is how a recipient gets
 * it twice.
 */
export function canOperatorRetry(dispatch: {
  status: string;
  deadLetteredAt: Date | null;
  nextAttemptAt: Date | null;
}): boolean {
  if (dispatch.status !== 'failed') return false;
  if (dispatch.deadLetteredAt) return true;
  // Still scheduled: the sender will pick it up on its own.
  return dispatch.nextAttemptAt === null;
}
