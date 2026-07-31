import {
  MANUAL_DISPATCH_CHANNELS,
  type DispatchChannel,
  type DispatchStatus,
  type DocClass,
  type DocumentStatus,
} from '@cuks/shared';
import { AppException } from '../../common/exceptions/app.exception';

/**
 * The dispatch state machine (docs/modules/11 §12.1, plan §6.8). Pure, so every branch is
 * unit-tested without a database, and shared by the service and the card policy.
 *
 * Sending is not a document status: `documents.status` has one slot, and a letter that went
 * out, came back and went out again has three facts to record. Each attempt is its own row
 * with its own terminal state, and a later success never rewrites an earlier failure.
 */

/** What the caller may still do to an attempt in this state. */
export const DISPATCH_ACTIONS = ['confirm', 'fail', 'cancel', 'retry'] as const;
export type DispatchAction = (typeof DISPATCH_ACTIONS)[number];

/** The document facts the dispatch policy reads. */
export interface DispatchableDocument {
  docClass: DocClass;
  status: DocumentStatus;
  regNumber: string | null;
}

/**
 * A document may be dispatched once it has a number and only if it is ours to send
 * (plan этап 6: «cannot dispatch draft/unregistered»).
 *
 * The number is the point: a dispatch record says «этот документ ушёл туда-то», and a draft
 * has nothing citable to put on the envelope. Internal documents are distributed through
 * acquaintance, not sent — a dispatch row for one would claim an external addressee that
 * does not exist.
 */
export function assertDocumentDispatchable(doc: DispatchableDocument): void {
  if (doc.docClass !== 'outgoing') {
    throw AppException.unprocessable(
      'docflow.dispatch.not_outgoing',
      'Only an outgoing document is dispatched',
      { docClass: doc.docClass },
    );
  }
  if (!doc.regNumber) {
    throw AppException.unprocessable(
      'docflow.dispatch.not_registered',
      'The document must be registered before it can be sent',
      { status: doc.status },
    );
  }
  if (doc.status === 'archived') {
    throw AppException.conflict(
      'docflow.dispatch.document_archived',
      'An archived document cannot be sent',
    );
  }
}

/**
 * Machine channels exist in the model from day one but only send through a locally
 * configured adapter — CUKS runs in an isolated network and reaches no external service
 * (docs/02 §1). Without an adapter the channel is refused up front rather than accepted and
 * silently never sent, which would leave the chancellery believing a letter had gone out.
 */
export function assertChannelUsable(
  channel: DispatchChannel,
  configuredAdapters: readonly DispatchChannel[],
): void {
  if (MANUAL_DISPATCH_CHANNELS.includes(channel)) return;
  if (configuredAdapters.includes(channel)) return;
  throw AppException.unprocessable(
    'docflow.dispatch.channel_unavailable',
    'No adapter is configured for this channel',
    { channel },
  );
}

/** The state each action moves an attempt to; `retry` opens a new attempt instead. */
const TRANSITIONS: Record<Exclude<DispatchAction, 'retry'>, DispatchStatus> = {
  confirm: 'sent',
  fail: 'failed',
  cancel: 'cancelled',
};

/**
 * Only a pending attempt can be decided. Deciding a decided attempt is refused rather than
 * applied, because «переотправили» is a new attempt with its own date — overwriting the old
 * row would erase when the first one actually left.
 */
export function planDispatchDecision(
  current: DispatchStatus,
  action: Exclude<DispatchAction, 'retry'>,
): DispatchStatus {
  if (current !== 'pending') {
    throw AppException.conflict(
      'docflow.dispatch.not_pending',
      'This send attempt has already been decided',
      { status: current },
    );
  }
  return TRANSITIONS[action];
}

/**
 * A retry copies a spent attempt into a fresh pending one. Only a failed or cancelled
 * attempt may be retried: retrying a `sent` one would send the same letter twice on the
 * strength of a mis-click, and a `pending` one is still open — the operator wants that row,
 * not a second one beside it.
 */
export function assertRetryable(current: DispatchStatus): void {
  if (current === 'failed' || current === 'cancelled') return;
  throw AppException.conflict(
    'docflow.dispatch.not_retryable',
    'Only a failed or cancelled attempt can be retried',
    { status: current },
  );
}

/**
 * Whether a document has been successfully sent — the completion policy's input. A
 * cancelled or failed attempt is not a send, and a document with several attempts counts as
 * sent as soon as one of them succeeded.
 */
export function isDispatched(statuses: readonly DispatchStatus[]): boolean {
  return statuses.includes('sent');
}

/**
 * After a confirmed send an outgoing document has nothing left to do, so the card should not
 * keep showing it as work in progress (plan этап 6: «успешная отправка и completion
 * policy»). The move is proposed, never forced: a document that still owes an instruction or
 * a reading stays open, and the caller checks those obligations under the same lock.
 */
export function planCompletionAfterDispatch(status: DocumentStatus): DocumentStatus | null {
  return status === 'registered' || status === 'in_progress' ? 'completed' : null;
}
