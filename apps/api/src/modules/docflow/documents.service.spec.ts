import { describe, expect, it } from 'vitest';
import { DOCUMENT_STATUSES, type DocumentStatus } from '@cuks/shared';
import {
  assertIncomingJournal,
  assertNoOpenObligations,
  planDocumentStatusChange,
  type DocumentObligations,
} from './documents.service';

/** Assert that the lifecycle policy rejects the change with the given error code. */
function expectRejected(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable('expected the lifecycle policy to reject the change');
  } catch (error) {
    expect(error).toMatchObject({ code });
  }
}

describe('planDocumentStatusChange', () => {
  it('allows a permitted transition and passes through a trimmed reason', () => {
    expect(planDocumentStatusChange('registered', { status: 'in_progress' })).toEqual({
      status: 'in_progress',
      reason: null,
    });
    expect(planDocumentStatusChange('in_progress', { status: 'completed' }).status).toBe(
      'completed',
    );
    expect(
      planDocumentStatusChange('pending_registration', {
        status: 'rejected',
        reason: '  Неверные реквизиты  ',
      }),
    ).toEqual({ status: 'rejected', reason: 'Неверные реквизиты' });
  });

  it('rejects a no-op transition as a conflict', () => {
    expectRejected(
      () => planDocumentStatusChange('draft', { status: 'draft' }),
      'docflow.document.status_unchanged',
    );
  });

  it('rejects a transition not in the policy graph', () => {
    expectRejected(
      () => planDocumentStatusChange('draft', { status: 'completed' }),
      'docflow.document.invalid_transition',
    );
    expectRejected(
      () => planDocumentStatusChange('archived', { status: 'in_progress' }),
      'docflow.document.invalid_transition',
    );
  });

  it('never lets a manual status change reach "registered" (register is the only path)', () => {
    // The number is minted only by register(); a plain author must not self-register.
    expectRejected(
      () => planDocumentStatusChange('draft', { status: 'registered' }),
      'docflow.document.invalid_transition',
    );
    expectRejected(
      () => planDocumentStatusChange('pending_registration', { status: 'registered' }),
      'docflow.document.invalid_transition',
    );
  });

  it('requires a reason to reject or recall', () => {
    expectRejected(
      () => planDocumentStatusChange('pending_registration', { status: 'rejected' }),
      'docflow.document.reason_required',
    );
    expectRejected(
      () => planDocumentStatusChange('pending_registration', { status: 'rejected', reason: '  ' }),
      'docflow.document.reason_required',
    );
    expectRejected(
      () => planDocumentStatusChange('rejected', { status: 'recalled' }),
      'docflow.document.reason_required',
    );
  });
});

describe('assertNoOpenObligations', () => {
  const clear: DocumentObligations = {
    activeRouteSteps: 0,
    activeResolutions: 0,
    pendingAcquaintances: 0,
  };
  /** Every status that does NOT assert the work is finished. */
  const nonClosing = DOCUMENT_STATUSES.filter(
    (s): s is DocumentStatus => s !== 'completed' && s !== 'archived',
  );

  it('lets a document close when nothing is open', () => {
    expect(() => assertNoOpenObligations('completed', clear)).not.toThrow();
    expect(() => assertNoOpenObligations('archived', clear)).not.toThrow();
  });

  it('only gates the two closing statuses — the rest of the lifecycle is untouched', () => {
    // Moving to `in_progress` with a live resolution is the NORMAL case; the gate must
    // not turn every transition into an obligation check.
    for (const status of nonClosing) {
      expect(() =>
        assertNoOpenObligations(status, {
          activeRouteSteps: 3,
          activeResolutions: 2,
          pendingAcquaintances: 5,
        }),
      ).not.toThrow();
    }
  });

  it('refuses to close over an active route step', () => {
    expectRejected(
      () => assertNoOpenObligations('completed', { ...clear, activeRouteSteps: 1 }),
      'docflow.document.route_open',
    );
    expectRejected(
      () => assertNoOpenObligations('archived', { ...clear, activeRouteSteps: 1 }),
      'docflow.document.route_open',
    );
  });

  it('refuses to close over an unexecuted resolution', () => {
    expectRejected(
      () => assertNoOpenObligations('completed', { ...clear, activeResolutions: 2 }),
      'docflow.document.resolution_open',
    );
  });

  it('refuses to close over an unread acquaintance', () => {
    expectRejected(
      () => assertNoOpenObligations('archived', { ...clear, pendingAcquaintances: 4 }),
      'docflow.document.acquaintance_open',
    );
  });

  it('reports the route first when several obligations are open', () => {
    // Deterministic ordering so the user is told what to do next, not a random one of three.
    expectRejected(
      () =>
        assertNoOpenObligations('completed', {
          activeRouteSteps: 1,
          activeResolutions: 1,
          pendingAcquaintances: 1,
        }),
      'docflow.document.route_open',
    );
  });
});

describe('assertIncomingJournal', () => {
  it('accepts an active incoming book', () => {
    expect(() => assertIncomingJournal({ docClass: 'incoming', isActive: true })).not.toThrow();
  });

  it('rejects a missing journal', () => {
    expectRejected(() => assertIncomingJournal(undefined), 'docflow.journal.not_found');
  });

  it('rejects a closed journal — a retired book must not keep minting numbers', () => {
    expectRejected(
      () => assertIncomingJournal({ docClass: 'incoming', isActive: false }),
      'docflow.journal.inactive',
    );
  });

  it('rejects a book of the wrong class', () => {
    expectRejected(
      () => assertIncomingJournal({ docClass: 'outgoing', isActive: true }),
      'docflow.journal.class_mismatch',
    );
    expectRejected(
      () => assertIncomingJournal({ docClass: 'internal', isActive: true }),
      'docflow.journal.class_mismatch',
    );
  });
});
