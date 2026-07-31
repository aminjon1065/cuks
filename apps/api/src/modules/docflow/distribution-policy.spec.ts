import { describe, expect, it } from 'vitest';
import type { DistributionTargetInput } from '@cuks/shared';
import { AppException } from '../../common/exceptions/app.exception';
import {
  assertDocumentDistributable,
  assertHasReaders,
  foldReaders,
  restrictToAllowList,
  type DistributableDocument,
} from './distribution-policy';

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

const doc = (over: Partial<DistributableDocument> = {}): DistributableDocument => ({
  docClass: 'internal',
  status: 'registered',
  regNumber: 'П-2026/0001',
  ...over,
});

const target = (over: Partial<DistributionTargetInput> = {}): DistributionTargetInput => ({
  type: 'org_unit',
  id: 'unit-1',
  includeSubtree: false,
  ...over,
});

describe('assertDocumentDistributable', () => {
  it('accepts a registered internal document', () => {
    expect(() => assertDocumentDistributable(doc())).not.toThrow();
    expect(() => assertDocumentDistributable(doc({ status: 'in_progress' }))).not.toThrow();
  });

  it('refuses an unregistered one — readers would acknowledge a text that can still change', () => {
    expectCode(
      () => assertDocumentDistributable(doc({ status: 'draft', regNumber: null })),
      'docflow.distribution.not_registered',
    );
  });

  it('refuses anything that is not an internal document', () => {
    // An incoming letter arrived from outside; an outgoing one leaves through dispatch.
    expectCode(
      () => assertDocumentDistributable(doc({ docClass: 'incoming' })),
      'docflow.distribution.not_internal',
    );
    expectCode(
      () => assertDocumentDistributable(doc({ docClass: 'outgoing' })),
      'docflow.distribution.not_internal',
    );
  });

  it('refuses an archived document', () => {
    expectCode(
      () => assertDocumentDistributable(doc({ status: 'archived' })),
      'docflow.distribution.document_archived',
    );
  });
});

describe('foldReaders', () => {
  it('gives one line per person, however many targets reached them', () => {
    const unit = target({ type: 'org_unit', id: 'u1' });
    const person = target({ type: 'user', id: 'a' });
    const readers = foldReaders([
      { target: unit, userIds: ['a', 'b', 'c'] },
      { target: person, userIds: ['a'] },
    ]);
    expect(readers.map((r) => r.userId).sort()).toEqual(['a', 'b', 'c']);
    // The first target that reached them is what the sheet explains, not the last.
    expect(readers.find((r) => r.userId === 'a')).toMatchObject({
      viaType: 'org_unit',
      viaId: 'u1',
    });
  });

  it('folds duplicates inside a single expansion too', () => {
    // A subtree expansion can return the same person twice when they hold two posts.
    const readers = foldReaders([{ target: target(), userIds: ['a', 'a', 'b'] }]);
    expect(readers).toHaveLength(2);
  });

  it('preserves the order readers were reached in', () => {
    const readers = foldReaders([
      { target: target({ type: 'user', id: 'x' }), userIds: ['x'] },
      { target: target({ type: 'org_unit', id: 'u' }), userIds: ['y', 'z'] },
    ]);
    expect(readers.map((r) => r.userId)).toEqual(['x', 'y', 'z']);
  });

  it('returns nothing for targets that reached nobody', () => {
    expect(foldReaders([{ target: target(), userIds: [] }])).toEqual([]);
    expect(foldReaders([])).toEqual([]);
  });
});

describe('assertHasReaders', () => {
  it('refuses a distribution that reaches nobody', () => {
    // «Распространён» with an empty sheet is indistinguishable from «никто ещё не прочёл».
    expectCode(() => assertHasReaders([]), 'docflow.distribution.no_readers');
  });

  it('passes as soon as one person is reached', () => {
    expect(() => assertHasReaders([{ userId: 'a', viaType: 'user', viaId: 'a' }])).not.toThrow();
  });
});

describe('restrictToAllowList', () => {
  const reader = (id: string) => ({ userId: id, viaType: 'org_unit' as const, viaId: 'u1' });

  it('leaves an ordinary document alone', () => {
    const readers = [reader('a'), reader('b')];
    const out = restrictToAllowList(readers, { confidentiality: 'normal', accessList: [] });
    expect(out.readers).toHaveLength(2);
    expect(out.excluded).toBe(0);
  });

  it('drops readers a ДСП order was never cleared to reach', () => {
    // Being on the sheet counts as participation elsewhere in the module, so an unfiltered
    // subdivision target would hand a ДСП document to everybody in it (docs/09 §3).
    const out = restrictToAllowList([reader('a'), reader('b'), reader('c')], {
      confidentiality: 'dsp',
      accessList: ['a', 'c'],
    });
    expect(out.readers.map((r) => r.userId)).toEqual(['a', 'c']);
    expect(out.excluded, 'and says how many it dropped, for the audit').toBe(1);
  });

  it('can leave nothing, which the caller then refuses', () => {
    const out = restrictToAllowList([reader('a')], {
      confidentiality: 'dsp',
      accessList: ['someone-else'],
    });
    expect(out.readers).toHaveLength(0);
    expect(() => assertHasReaders(out.readers)).toThrow(AppException);
  });
});
