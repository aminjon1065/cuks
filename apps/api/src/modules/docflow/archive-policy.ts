import {
  addMonthsUtc,
  type DispositionBatchStatus,
  type DispositionStatus,
  type DocumentStatus,
} from '@cuks/shared';
import { AppException } from '../../common/exceptions/app.exception';

/**
 * Archive, retention and disposition (docs/modules/11 §12.12, plan §6.9).
 *
 * Every rule here is pure, because every one of them decides whether a record can be lost.
 * The shape of the whole stage is one sentence: a machine may only ever say «этот документ
 * похож на кандидата»; taking a document out of the archive, holding it, and disposing of it
 * are all human acts with a name, a reason and an audit entry attached.
 */

/** The case rule a document is filed under, as the nomenclature states it. */
export interface RetentionRule {
  retentionMonths: number | null;
  isPermanent: boolean;
}

/** The snapshot written onto the document when it is archived — never recomputed after. */
export interface RetentionSnapshot {
  retentionUntil: Date | null;
  retentionMonths: number | null;
  isPermanent: boolean;
}

/**
 * Freeze the retention rule onto the document at the moment it is filed.
 *
 * A SNAPSHOT, not a reference: editing the nomenclature next year must not silently move a
 * deadline somebody already answered for — that is the difference between a records system
 * and a spreadsheet. A case with no stated term produces no deadline at all rather than a
 * guessed one: a document with `retention_until = null` is simply never swept up, which is
 * the safe direction to be wrong in.
 */
export function planRetention(rule: RetentionRule | null, archivedAt: Date): RetentionSnapshot {
  if (!rule || rule.isPermanent) {
    return {
      retentionUntil: null,
      retentionMonths: rule?.retentionMonths ?? null,
      isPermanent: rule?.isPermanent ?? false,
    };
  }
  if (rule.retentionMonths === null || rule.retentionMonths <= 0) {
    return { retentionUntil: null, retentionMonths: null, isPermanent: false };
  }
  return {
    retentionUntil: addMonthsUtc(archivedAt, rule.retentionMonths),
    retentionMonths: rule.retentionMonths,
    isPermanent: false,
  };
}

/** The document facts every archive rule reads. */
export interface ArchivableDocument {
  status: DocumentStatus;
  regNumber: string | null;
  archivedAt: Date | null;
  legalHold: boolean;
  dispositionStatus: DispositionStatus;
}

/** Statuses a document may be filed away from (mirrors DOCUMENT_STATUS_TRANSITIONS). */
const ARCHIVABLE_STATUSES: readonly DocumentStatus[] = ['registered', 'in_progress', 'completed'];

/**
 * A document is filed into a case once its work is finished and it has a number to be filed
 * under. An unregistered draft cannot be archived: the case index is a place in a register,
 * and there would be nothing to write in it.
 */
export function assertArchivable(doc: ArchivableDocument): void {
  if (doc.archivedAt) {
    throw AppException.conflict(
      'docflow.archive.already_archived',
      'The document is already archived',
    );
  }
  if (!doc.regNumber) {
    throw AppException.unprocessable(
      'docflow.archive.not_registered',
      'Only a registered document is filed into a case',
    );
  }
  if (!ARCHIVABLE_STATUSES.includes(doc.status)) {
    throw AppException.unprocessable(
      'docflow.archive.not_archivable',
      'The document cannot be archived in its current status',
      { status: doc.status },
    );
  }
}

/**
 * Taking a document back out of the archive is an exception, so it is refused for anything
 * already decided about: a disposed record is closed, and one inside a live act of disposal
 * would silently leave that act half-answered.
 */
export function assertRestorable(doc: ArchivableDocument): void {
  if (!doc.archivedAt) {
    throw AppException.conflict('docflow.archive.not_archived', 'The document is not archived');
  }
  if (doc.dispositionStatus === 'executed') {
    throw AppException.conflict(
      'docflow.archive.disposed',
      'A disposed document cannot be restored',
    );
  }
  if (doc.dispositionStatus === 'pending' || doc.dispositionStatus === 'approved') {
    throw AppException.conflict(
      'docflow.archive.in_disposition',
      'The document is inside an act of disposal; withdraw it from the act first',
      { dispositionStatus: doc.dispositionStatus },
    );
  }
}

/**
 * Whether the retention clock has run out on an archived document — the ONLY thing the sweep
 * decides.
 *
 * Four independent reasons to leave a document alone, and the order does not matter because
 * every one of them is a veto: it is not archived; it is kept permanently; a legal hold is
 * set; or it has no deadline at all. A hold is checked here as well as at every command,
 * because «legal hold невозможно обойти» has to hold for the machine too.
 */
export function isDispositionCandidate(
  doc: ArchivableDocument & { retentionUntil: Date | null },
  now: Date,
): boolean {
  if (!doc.archivedAt) return false;
  if (doc.legalHold) return false;
  if (!doc.retentionUntil) return false;
  if (doc.dispositionStatus !== 'none' && doc.dispositionStatus !== 'candidate') return false;
  return doc.retentionUntil.getTime() <= now.getTime();
}

/**
 * A legal hold blocks disposal outright (plan этап 8 приёмка: «legal hold невозможно обойти ни
 * UI, ни прямым API»). Called by every path that could move a document towards disposal —
 * adding it to an act, approving one, executing one — so no single missing check can open it.
 */
export function assertNotLegalHeld(doc: { legalHold: boolean }, action: string): void {
  if (doc.legalHold) {
    throw AppException.conflict(
      'docflow.archive.legal_hold',
      'A document under legal hold cannot be disposed of',
      { action },
    );
  }
}

/** A document may only enter an act of disposal from the archive, with its term run out. */
export function assertDisposable(
  doc: ArchivableDocument & { retentionUntil: Date | null; isPermanent: boolean },
  now: Date,
): void {
  assertNotLegalHeld(doc, 'disposition');
  if (!doc.archivedAt) {
    throw AppException.unprocessable(
      'docflow.archive.not_archived',
      'Only an archived document can be disposed of',
    );
  }
  if (doc.isPermanent) {
    throw AppException.unprocessable(
      'docflow.archive.permanent',
      'The document is kept permanently',
    );
  }
  if (!doc.retentionUntil || doc.retentionUntil.getTime() > now.getTime()) {
    throw AppException.unprocessable(
      'docflow.archive.retention_active',
      'The retention term has not run out',
      { retentionUntil: doc.retentionUntil?.toISOString() ?? null },
    );
  }
  if (doc.dispositionStatus === 'executed') {
    throw AppException.conflict('docflow.archive.disposed', 'The document is already disposed of');
  }
}

/** What each act transition is allowed to move from. */
const BATCH_TRANSITIONS: Record<
  'submit' | 'approve' | 'reject' | 'execute',
  readonly DispositionBatchStatus[]
> = {
  submit: ['draft'],
  approve: ['pending'],
  reject: ['pending'],
  execute: ['approved'],
};

/**
 * Move an act of disposal. Approval and execution are deliberately separate states: signing
 * off on a list and destroying what is on it are two decisions, and collapsing them would
 * make one mis-click irreversible.
 */
export function planBatchTransition(
  current: DispositionBatchStatus,
  action: 'submit' | 'approve' | 'reject' | 'execute',
): DispositionBatchStatus {
  if (!BATCH_TRANSITIONS[action].includes(current)) {
    throw AppException.conflict(
      'docflow.disposition.invalid_transition',
      'That act cannot move that way from its current state',
      { status: current, action },
    );
  }
  return action === 'submit'
    ? 'pending'
    : action === 'approve'
      ? 'approved'
      : action === 'reject'
        ? 'rejected'
        : 'executed';
}

/**
 * The reviewer must not be the author of the act (plan этап 8 приёмка).
 *
 * Four eyes on an irreversible decision: whoever assembled the list of documents to destroy
 * is exactly the person whose mistake a second reader is there to catch. A superadmin is not
 * excused — the rule is about the act, not about rank.
 */
export function assertSeparateReviewer(createdBy: string | null, actorId: string): void {
  if (createdBy && createdBy === actorId) {
    throw AppException.forbidden(
      'docflow.disposition.self_review',
      'An act of disposal is reviewed by somebody other than its author',
    );
  }
}
