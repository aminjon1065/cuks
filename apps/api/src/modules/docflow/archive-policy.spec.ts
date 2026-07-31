import { describe, expect, it } from 'vitest';
import type { DispositionStatus, DocumentStatus } from '@cuks/shared';
import { AppException } from '../../common/exceptions/app.exception';
import {
  assertArchivable,
  assertDisposable,
  assertNotLegalHeld,
  assertRestorable,
  assertSeparateReviewer,
  isDispositionCandidate,
  planBatchTransition,
  planRetention,
  type ArchivableDocument,
} from './archive-policy';

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

const ARCHIVED_AT = new Date('2026-01-15T10:00:00Z');

const doc = (
  over: Partial<ArchivableDocument & { retentionUntil: Date | null; isPermanent: boolean }> = {},
) => ({
  status: 'completed' as DocumentStatus,
  regNumber: 'П-2026/0001',
  archivedAt: ARCHIVED_AT,
  legalHold: false,
  dispositionStatus: 'none' as DispositionStatus,
  retentionUntil: new Date('2031-01-15T10:00:00Z'),
  isPermanent: false,
  ...over,
});

describe('planRetention', () => {
  it('freezes a term of months onto the document', () => {
    const snap = planRetention({ retentionMonths: 60, isPermanent: false }, ARCHIVED_AT);
    expect(snap.retentionUntil?.toISOString()).toBe('2031-01-15T10:00:00.000Z');
    // The numbers it was derived from travel with it, so the date can be explained later.
    expect(snap.retentionMonths).toBe(60);
    expect(snap.isPermanent).toBe(false);
  });

  it('gives a permanent case no deadline at all', () => {
    const snap = planRetention({ retentionMonths: null, isPermanent: true }, ARCHIVED_AT);
    expect(snap.retentionUntil).toBeNull();
    expect(snap.isPermanent).toBe(true);
  });

  it('gives no deadline when the case states no term — a guess is worse than none', () => {
    expect(
      planRetention({ retentionMonths: null, isPermanent: false }, ARCHIVED_AT).retentionUntil,
    ).toBeNull();
    expect(planRetention(null, ARCHIVED_AT).retentionUntil).toBeNull();
    expect(
      planRetention({ retentionMonths: 0, isPermanent: false }, ARCHIVED_AT).retentionUntil,
    ).toBeNull();
  });

  it('clamps the day instead of rolling into the next month', () => {
    // 31 января + 1 месяц is the end of February, not the 3rd of March: rolling over would
    // hand the record extra days of retention every time the arithmetic crossed a short month.
    const snap = planRetention(
      { retentionMonths: 1, isPermanent: false },
      new Date('2026-01-31T00:00:00Z'),
    );
    expect(snap.retentionUntil?.toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });

  it('is a snapshot: the same input always yields the same date, whatever the rule becomes', () => {
    const first = planRetention({ retentionMonths: 12, isPermanent: false }, ARCHIVED_AT);
    // The document keeps `first`; a later, longer rule produces a different date only for
    // documents archived after the change.
    const later = planRetention({ retentionMonths: 120, isPermanent: false }, ARCHIVED_AT);
    expect(first.retentionUntil?.toISOString()).not.toBe(later.retentionUntil?.toISOString());
    expect(first.retentionUntil?.toISOString()).toBe('2027-01-15T10:00:00.000Z');
  });
});

describe('assertArchivable', () => {
  it('files a finished, numbered document', () => {
    expect(() => assertArchivable(doc({ archivedAt: null }))).not.toThrow();
    expect(() => assertArchivable(doc({ archivedAt: null, status: 'registered' }))).not.toThrow();
  });

  it('refuses one that is already filed', () => {
    expectCode(() => assertArchivable(doc()), 'docflow.archive.already_archived');
  });

  it('refuses an unnumbered draft — there is nothing to file it under', () => {
    expectCode(
      () => assertArchivable(doc({ archivedAt: null, status: 'draft', regNumber: null })),
      'docflow.archive.not_registered',
    );
  });

  it('refuses a document still travelling', () => {
    expectCode(
      () => assertArchivable(doc({ archivedAt: null, status: 'on_route' })),
      'docflow.archive.not_archivable',
    );
  });
});

describe('assertRestorable', () => {
  it('takes an archived document back out', () => {
    expect(() => assertRestorable(doc())).not.toThrow();
    expect(() => assertRestorable(doc({ dispositionStatus: 'candidate' }))).not.toThrow();
    expect(() => assertRestorable(doc({ dispositionStatus: 'rejected' }))).not.toThrow();
  });

  it('refuses one that was never archived', () => {
    expectCode(() => assertRestorable(doc({ archivedAt: null })), 'docflow.archive.not_archived');
  });

  it('never resurrects a disposed record', () => {
    expectCode(
      () => assertRestorable(doc({ dispositionStatus: 'executed' })),
      'docflow.archive.disposed',
    );
  });

  it('refuses one inside a live act, which would leave the act half-answered', () => {
    for (const status of ['pending', 'approved'] as DispositionStatus[]) {
      expectCode(
        () => assertRestorable(doc({ dispositionStatus: status })),
        'docflow.archive.in_disposition',
      );
    }
  });
});

describe('isDispositionCandidate', () => {
  const now = new Date('2031-06-01T00:00:00Z');

  it('marks an archived document whose term has run out', () => {
    expect(isDispositionCandidate(doc(), now)).toBe(true);
  });

  it('leaves an active term alone', () => {
    // The single most important negative: a live retention term is not a candidate.
    expect(
      isDispositionCandidate(doc({ retentionUntil: new Date('2040-01-01T00:00:00Z') }), now),
    ).toBe(false);
  });

  it('never marks a permanent or termless document', () => {
    expect(isDispositionCandidate(doc({ retentionUntil: null }), now)).toBe(false);
  });

  it('never marks a document under legal hold, however old', () => {
    // The machine obeys the hold too — that is what «нельзя обойти» has to mean.
    expect(isDispositionCandidate(doc({ legalHold: true }), now)).toBe(false);
  });

  it('never marks an unarchived document', () => {
    expect(isDispositionCandidate(doc({ archivedAt: null }), now)).toBe(false);
  });

  it('leaves anything already decided about alone', () => {
    for (const status of ['pending', 'approved', 'rejected', 'executed'] as DispositionStatus[]) {
      expect(isDispositionCandidate(doc({ dispositionStatus: status }), now)).toBe(false);
    }
    // …but re-marking an existing candidate is harmless, so the sweep stays idempotent.
    expect(isDispositionCandidate(doc({ dispositionStatus: 'candidate' }), now)).toBe(true);
  });
});

describe('assertDisposable', () => {
  const now = new Date('2031-06-01T00:00:00Z');

  it('allows a lapsed, unheld archived document', () => {
    expect(() => assertDisposable(doc(), now)).not.toThrow();
  });

  it('refuses a legal hold before anything else', () => {
    expectCode(() => assertDisposable(doc({ legalHold: true }), now), 'docflow.archive.legal_hold');
    // Even when everything else about it says it could go.
    expectCode(
      () =>
        assertDisposable(
          doc({ legalHold: true, retentionUntil: new Date('2000-01-01T00:00:00Z') }),
          now,
        ),
      'docflow.archive.legal_hold',
    );
  });

  it('refuses a permanent case and a live term', () => {
    expectCode(
      () => assertDisposable(doc({ isPermanent: true }), now),
      'docflow.archive.permanent',
    );
    expectCode(
      () => assertDisposable(doc({ retentionUntil: new Date('2040-01-01T00:00:00Z') }), now),
      'docflow.archive.retention_active',
    );
    expectCode(
      () => assertDisposable(doc({ retentionUntil: null }), now),
      'docflow.archive.retention_active',
    );
  });

  it('refuses one that never reached the archive', () => {
    expectCode(
      () => assertDisposable(doc({ archivedAt: null }), now),
      'docflow.archive.not_archived',
    );
  });
});

describe('assertNotLegalHeld', () => {
  it('blocks whatever action names it', () => {
    expectCode(
      () => assertNotLegalHeld({ legalHold: true }, 'execute'),
      'docflow.archive.legal_hold',
    );
    expect(() => assertNotLegalHeld({ legalHold: false }, 'execute')).not.toThrow();
  });
});

describe('planBatchTransition', () => {
  it('walks draft → pending → approved → executed', () => {
    expect(planBatchTransition('draft', 'submit')).toBe('pending');
    expect(planBatchTransition('pending', 'approve')).toBe('approved');
    expect(planBatchTransition('pending', 'reject')).toBe('rejected');
    expect(planBatchTransition('approved', 'execute')).toBe('executed');
  });

  it('never executes an act nobody approved', () => {
    // Signing off on a list and destroying what is on it are two decisions.
    expectCode(
      () => planBatchTransition('draft', 'execute'),
      'docflow.disposition.invalid_transition',
    );
    expectCode(
      () => planBatchTransition('pending', 'execute'),
      'docflow.disposition.invalid_transition',
    );
    expectCode(
      () => planBatchTransition('rejected', 'execute'),
      'docflow.disposition.invalid_transition',
    );
  });

  it('never re-decides a decided act', () => {
    expectCode(
      () => planBatchTransition('executed', 'approve'),
      'docflow.disposition.invalid_transition',
    );
    expectCode(
      () => planBatchTransition('approved', 'approve'),
      'docflow.disposition.invalid_transition',
    );
  });
});

describe('assertSeparateReviewer', () => {
  it('refuses the author reviewing their own act', () => {
    // Four eyes on an irreversible decision: the author's mistake is what the second reader
    // is there to catch.
    expectCode(() => assertSeparateReviewer('u1', 'u1'), 'docflow.disposition.self_review');
  });

  it('allows anybody else', () => {
    expect(() => assertSeparateReviewer('u1', 'u2')).not.toThrow();
    expect(() => assertSeparateReviewer(null, 'u2')).not.toThrow();
  });
});
