import { describe, expect, it } from 'vitest';
import { planDocumentStatusChange } from './documents.service';

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
