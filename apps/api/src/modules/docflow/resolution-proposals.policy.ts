import {
  ACQUAINTANCE_GATE_HOURS,
  type AcquaintanceReleaseReason,
  type ResolutionProposalStatus,
} from '@cuks/shared';
import { AppException } from '../../common/exceptions/app.exception';

/** The proposal fields the decision policy reasons over. */
export interface DecidableProposal {
  status: ResolutionProposalStatus;
  signerId: string;
}

/** Who is trying to decide, and whom they may act for (docs/05 §6). */
export interface DecidingActor {
  id: string;
  isSuperadmin: boolean;
  /** Principals this actor is an ACTIVE deputy for. */
  principalIds: readonly string[];
}

/**
 * May this actor decide the proposal, and — if via a substitution — whom for
 * (docs/modules/11 §12.11)?
 *
 * Exactly one person is asked for a decision, so a proposal cannot be approved by whoever
 * happens to hold the right permission: a resolution carries the authority of the person
 * who signed it. A deputy may act, and the principal they acted «за» is recorded, because
 * an unattributed approval is indistinguishable from an impersonation after the fact.
 *
 * Pure: the whole matrix is unit-tested and the same answer drives the signer's queue.
 */
export function resolveProposalDecider(
  proposal: DecidableProposal,
  actor: DecidingActor,
): { decidedFor: string | null } {
  if (proposal.status !== 'pending') {
    throw AppException.conflict(
      'docflow.proposal.not_pending',
      'Only a submitted proposal can be decided',
      { status: proposal.status },
    );
  }
  if (actor.id === proposal.signerId) return { decidedFor: null };
  if (actor.principalIds.includes(proposal.signerId)) return { decidedFor: proposal.signerId };
  // A superadmin override is deliberately last and still attributed to the signer, so the
  // record never reads as though the signer personally decided.
  if (actor.isSuperadmin) return { decidedFor: proposal.signerId };
  throw AppException.forbidden(
    'docflow.proposal.signer_mismatch',
    'Only the named signer (or their deputy) may decide this proposal',
  );
}

/** Statuses from which the author may still edit or withdraw their draft. */
const EDITABLE_PROPOSAL_STATUSES: readonly ResolutionProposalStatus[] = ['draft', 'pending'];

export function assertProposalEditable(status: ResolutionProposalStatus): void {
  if (EDITABLE_PROPOSAL_STATUSES.includes(status)) return;
  throw AppException.conflict(
    'docflow.proposal.not_editable',
    'A decided proposal can no longer be changed',
    { status },
  );
}

/**
 * When the pre-execution gate should open by itself, and whether there is a gate at all
 * (docs/modules/11 §12.3).
 *
 * No readers means no gate: the executors get their instruction immediately, because a
 * gate with nobody behind it would delay work for no reason. The timeout is the
 * customer's four hours, kept as a named constant rather than a literal so the setting has
 * one home.
 */
export function planGate(
  acquaintUserIds: readonly string[],
  now: Date,
  gateHours: number = ACQUAINTANCE_GATE_HOURS,
): { gated: boolean; releaseAt: Date | null; availableAt: Date | null } {
  const readers = [...new Set(acquaintUserIds)];
  if (readers.length === 0) return { gated: false, releaseAt: null, availableAt: null };
  const releaseAt = new Date(now.getTime() + gateHours * 60 * 60 * 1000);
  // `available_at` mirrors `release_at`: until the gate opens the instruction is invisible,
  // and the queue query enforces that — not only the UI.
  return { gated: true, releaseAt, availableAt: releaseAt };
}

/**
 * Decide whether a gate should open now, and why (docs/modules/11 §12.3).
 *
 * Everyone having read it opens the gate early — the point of the wait is the reading, not
 * the clock. The timeout opens it too, but that is NOT compliance: the readers who did not
 * answer are marked `expired`, so a report can never present a timeout as everyone having
 * read the document.
 */
export function planRelease(
  batch: { releasedAt: Date | null; releaseAt: Date | null },
  pendingReaders: number,
  now: Date,
): AcquaintanceReleaseReason | null {
  if (batch.releasedAt) return null; // already open — the race was lost, and that is fine
  if (pendingReaders === 0) return 'all_acknowledged';
  if (batch.releaseAt && batch.releaseAt.getTime() <= now.getTime()) return 'timeout';
  return null;
}
