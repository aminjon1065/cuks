import { describe, expect, it } from 'vitest';
import type { DispatchChannel, DispatchStatus, DocClass, DocumentStatus } from '@cuks/shared';
import { AppException } from '../../common/exceptions/app.exception';
import {
  assertChannelUsable,
  assertDocumentDispatchable,
  assertRetryable,
  isDispatched,
  planCompletionAfterDispatch,
  planDispatchDecision,
} from './dispatch-policy';

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AppException);
    expect((error as AppException).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}, but nothing was thrown`);
}

const doc = (over: Partial<Parameters<typeof assertDocumentDispatchable>[0]> = {}) => ({
  docClass: 'outgoing' as DocClass,
  status: 'registered' as DocumentStatus,
  regNumber: 'ИСХ-2026/0001',
  ...over,
});

describe('assertDocumentDispatchable', () => {
  it('accepts a registered outgoing document', () => {
    expect(() => assertDocumentDispatchable(doc())).not.toThrow();
    expect(() => assertDocumentDispatchable(doc({ status: 'in_progress' }))).not.toThrow();
    expect(() => assertDocumentDispatchable(doc({ status: 'completed' }))).not.toThrow();
  });

  it('refuses an unregistered document — the envelope would carry no number', () => {
    expectCode(
      () => assertDocumentDispatchable(doc({ status: 'draft', regNumber: null })),
      'docflow.dispatch.not_registered',
    );
    expectCode(
      () => assertDocumentDispatchable(doc({ status: 'on_route', regNumber: null })),
      'docflow.dispatch.not_registered',
    );
  });

  it('refuses anything that is not ours to send outward', () => {
    // An internal document is distributed by acquaintance; an incoming one arrived here.
    expectCode(
      () => assertDocumentDispatchable(doc({ docClass: 'internal' })),
      'docflow.dispatch.not_outgoing',
    );
    expectCode(
      () => assertDocumentDispatchable(doc({ docClass: 'incoming' })),
      'docflow.dispatch.not_outgoing',
    );
  });

  it('refuses an archived document', () => {
    expectCode(
      () => assertDocumentDispatchable(doc({ status: 'archived' })),
      'docflow.dispatch.document_archived',
    );
  });
});

describe('assertChannelUsable', () => {
  it('always allows the manual channels — a human performs them and records the fact', () => {
    for (const channel of ['courier', 'postal', 'hand_delivery', 'other'] as DispatchChannel[]) {
      expect(() => assertChannelUsable(channel, [])).not.toThrow();
    }
  });

  it('refuses a machine channel with no configured adapter', () => {
    // Accepting it would leave the chancellery believing the letter had gone out.
    expectCode(() => assertChannelUsable('email', []), 'docflow.dispatch.channel_unavailable');
    expectCode(
      () => assertChannelUsable('integration', ['email']),
      'docflow.dispatch.channel_unavailable',
    );
  });

  it('allows a machine channel once its adapter is configured', () => {
    expect(() => assertChannelUsable('email', ['email'])).not.toThrow();
    expect(() => assertChannelUsable('integration', ['email', 'integration'])).not.toThrow();
  });
});

describe('planDispatchDecision', () => {
  it('maps each decision to its terminal state', () => {
    expect(planDispatchDecision('pending', 'confirm')).toBe('sent');
    expect(planDispatchDecision('pending', 'fail')).toBe('failed');
    expect(planDispatchDecision('pending', 'cancel')).toBe('cancelled');
  });

  it('refuses to re-decide a decided attempt', () => {
    // Overwriting would erase when the first attempt actually left.
    for (const status of ['sent', 'failed', 'cancelled'] as DispatchStatus[]) {
      expectCode(() => planDispatchDecision(status, 'confirm'), 'docflow.dispatch.not_pending');
    }
  });
});

describe('assertRetryable', () => {
  it('retries a spent attempt', () => {
    expect(() => assertRetryable('failed')).not.toThrow();
    expect(() => assertRetryable('cancelled')).not.toThrow();
  });

  it('never retries a sent or still-open attempt', () => {
    expectCode(() => assertRetryable('sent'), 'docflow.dispatch.not_retryable');
    expectCode(() => assertRetryable('pending'), 'docflow.dispatch.not_retryable');
  });
});

describe('isDispatched', () => {
  it('is true as soon as one attempt succeeded', () => {
    expect(isDispatched(['failed', 'sent'])).toBe(true);
    expect(isDispatched(['failed', 'cancelled', 'pending'])).toBe(false);
    expect(isDispatched([])).toBe(false);
  });
});

describe('planCompletionAfterDispatch', () => {
  it('proposes completion for a live registered document', () => {
    expect(planCompletionAfterDispatch('registered')).toBe('completed');
    expect(planCompletionAfterDispatch('in_progress')).toBe('completed');
  });

  it('proposes nothing when the document is already finished or elsewhere', () => {
    expect(planCompletionAfterDispatch('completed')).toBeNull();
    expect(planCompletionAfterDispatch('archived')).toBeNull();
    expect(planCompletionAfterDispatch('draft')).toBeNull();
  });
});
