import { describe, expect, it } from 'vitest';
import { ACQUAINTANCE_GATE_HOURS, type ResolutionProposalStatus } from '@cuks/shared';
import {
  assertProposalEditable,
  planGate,
  planRelease,
  resolveProposalDecider,
} from './resolution-proposals.policy';

const SIGNER = 'u-signer';
const DEPUTY = 'u-deputy';
const OTHER = 'u-other';

const pending = { status: 'pending' as ResolutionProposalStatus, signerId: SIGNER };
const actor = (
  id: string,
  over: Partial<{ isSuperadmin: boolean; principalIds: string[] }> = {},
) => ({
  id,
  isSuperadmin: false,
  principalIds: [] as string[],
  ...over,
});

/** Assert the policy rejects with the given code. */
function expectRejected(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable('expected the policy to reject');
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe('resolveProposalDecider', () => {
  it('lets the named signer decide, unattributed', () => {
    expect(resolveProposalDecider(pending, actor(SIGNER))).toEqual({ decidedFor: null });
  });

  it('lets an active deputy decide and records whom for', () => {
    // An unattributed approval is indistinguishable from an impersonation after the fact.
    expect(resolveProposalDecider(pending, actor(DEPUTY, { principalIds: [SIGNER] }))).toEqual({
      decidedFor: SIGNER,
    });
  });

  it('refuses anyone else, however senior', () => {
    expectRejected(
      () => resolveProposalDecider(pending, actor(OTHER)),
      'docflow.proposal.signer_mismatch',
    );
    // A deputy for somebody ELSE is not a deputy for this signer.
    expectRejected(
      () => resolveProposalDecider(pending, actor(DEPUTY, { principalIds: [OTHER] })),
      'docflow.proposal.signer_mismatch',
    );
  });

  it('still attributes a superadmin override to the signer', () => {
    // The record must never read as though the signer personally decided.
    expect(resolveProposalDecider(pending, actor(OTHER, { isSuperadmin: true }))).toEqual({
      decidedFor: SIGNER,
    });
  });

  it('refuses to decide anything that is not awaiting a decision', () => {
    for (const status of ['draft', 'approved', 'rejected', 'cancelled'] as const) {
      expectRejected(
        () => resolveProposalDecider({ status, signerId: SIGNER }, actor(SIGNER)),
        'docflow.proposal.not_pending',
      );
    }
  });
});

describe('assertProposalEditable', () => {
  it('allows a draft and a submitted proposal', () => {
    expect(() => assertProposalEditable('draft')).not.toThrow();
    expect(() => assertProposalEditable('pending')).not.toThrow();
  });

  it('freezes a decided proposal', () => {
    for (const status of ['approved', 'rejected', 'cancelled'] as const) {
      expectRejected(() => assertProposalEditable(status), 'docflow.proposal.not_editable');
    }
  });
});

describe('planGate', () => {
  const now = new Date('2026-07-31T06:00:00.000Z');

  it('creates no gate when nobody has to read first', () => {
    // A gate with nobody behind it would delay work for no reason.
    expect(planGate([], now)).toEqual({ gated: false, releaseAt: null, availableAt: null });
  });

  it('opens the gate the configured number of hours out', () => {
    const plan = planGate(['a', 'b'], now);
    expect(plan.gated).toBe(true);
    expect(plan.releaseAt?.toISOString()).toBe('2026-07-31T10:00:00.000Z');
    expect(ACQUAINTANCE_GATE_HOURS).toBe(4);
  });

  it('keeps availableAt in step with releaseAt', () => {
    // The instruction becomes visible exactly when the gate opens — the queue query
    // enforces it, not only the UI.
    const plan = planGate(['a'], now);
    expect(plan.availableAt?.toISOString()).toBe(plan.releaseAt?.toISOString());
  });

  it('deduplicates the reader list', () => {
    expect(planGate(['a', 'a'], now).gated).toBe(true);
  });
});

describe('planRelease', () => {
  const releaseAt = new Date('2026-07-31T10:00:00.000Z');
  const open = { releasedAt: null, releaseAt };

  it('opens early once everyone has read it', () => {
    // The point of the wait is the reading, not the clock.
    expect(planRelease(open, 0, new Date('2026-07-31T07:00:00.000Z'))).toBe('all_acknowledged');
  });

  it('keeps waiting while a reader is outstanding and the clock has not run out', () => {
    expect(planRelease(open, 1, new Date('2026-07-31T09:59:59.000Z'))).toBeNull();
  });

  it('opens on the timeout even with readers outstanding', () => {
    expect(planRelease(open, 2, releaseAt)).toBe('timeout');
    expect(planRelease(open, 2, new Date('2026-07-31T12:00:00.000Z'))).toBe('timeout');
  });

  it('is a no-op once the gate is already open — the racer that lost does nothing', () => {
    // The worker and a final acknowledgement race for release_at; whoever writes it owns
    // the release, and the loser must not release a second time.
    const released = { releasedAt: new Date('2026-07-31T08:00:00.000Z'), releaseAt };
    expect(planRelease(released, 0, new Date('2026-07-31T12:00:00.000Z'))).toBeNull();
    expect(planRelease(released, 3, new Date('2026-07-31T12:00:00.000Z'))).toBeNull();
  });

  it('never opens a gate that has no timeout and outstanding readers', () => {
    expect(planRelease({ releasedAt: null, releaseAt: null }, 1, new Date())).toBeNull();
  });
});
