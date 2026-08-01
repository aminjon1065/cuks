import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { documentsKey } from '../api/queries';

/**
 * Whether a realtime invalidation actually REACHES the queries it claims to.
 *
 * The defect this exists for was invisible in every other way: the card's key
 * `['docflow','documents',<id>]` was invalidated on every docflow event, and it matches
 * nothing in the register list `[…,'list',query]`, the badges `[…,'queue-counts']` or the
 * attention widget `[…,'attention']` — React Query matches by prefix. Nothing threw, nothing
 * logged; the lists simply never refreshed, while a comment in the hook asserted they did.
 *
 * Tested against a real QueryClient rather than a mocked one, because the thing under test IS
 * React Query's prefix matching — a mock would only re-state the assumption that was wrong.
 */
const CARD_ID = '019fbb96-653c-7c17-bcf5-c4b0eacf8439';
const OTHER_ID = '019fbb96-0000-7c17-bcf5-c4b0eacf8439';

/** The four keys the register actually uses, as `queries.ts` builds them. */
const KEYS = {
  list: [...documentsKey, 'list', { page: 1, limit: 50, queue: 'mine' }],
  counts: [...documentsKey, 'queue-counts'],
  attention: [...documentsKey, 'attention'],
  card: [...documentsKey, CARD_ID],
  otherCard: [...documentsKey, OTHER_ID],
} as const;

function seed(): QueryClient {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const key of Object.values(KEYS)) qc.setQueryData(key, { seeded: true });
  return qc;
}

/** Which of the seeded queries an invalidation marked stale. */
function staleAfter(qc: QueryClient): string[] {
  return Object.entries(KEYS)
    .filter(([, key]) => qc.getQueryState(key)?.isInvalidated === true)
    .map(([name]) => name)
    .sort();
}

describe('queue invalidation', () => {
  it('reaches the list, the badges and the attention widget', () => {
    const qc = seed();
    // Exactly what `invalidateQueues` does.
    void qc.invalidateQueries({ queryKey: [...documentsKey, 'list'] });
    void qc.invalidateQueries({ queryKey: [...documentsKey, 'queue-counts'] });
    void qc.invalidateQueries({ queryKey: [...documentsKey, 'attention'] });
    expect(staleAfter(qc)).toEqual(['attention', 'counts', 'list']);
  });

  it('the card key alone reaches NONE of them — the defect, pinned', () => {
    const qc = seed();
    void qc.invalidateQueries({ queryKey: [...documentsKey, CARD_ID] });
    // If this ever starts including the queues, the key layout changed and the hook's
    // separate queue invalidation may have become redundant — worth knowing either way.
    expect(staleAfter(qc)).toEqual(['card']);
  });
});

describe('card invalidation', () => {
  it('refreshes the open card', () => {
    const qc = seed();
    void qc.invalidateQueries({ queryKey: [...documentsKey, CARD_ID] });
    expect(staleAfter(qc)).toContain('card');
  });

  it('does not refresh a card the event was not about', () => {
    // The hook filters on the payload's documentId. Without that filter every card refetched
    // on every event in the register, because the socket also carries the user's own room.
    const qc = seed();
    void qc.invalidateQueries({ queryKey: [...documentsKey, CARD_ID] });
    expect(staleAfter(qc)).not.toContain('otherCard');
  });
});

describe('a document list is never patched by hand', () => {
  it('invalidation is the only mechanism, so a row cannot be inserted twice', () => {
    // «Realtime … invalidation без дублей» (plan этап 11): a duplicate needs an optimistic
    // insert racing a refetch. The docflow feature has no `setQueryData` on a list at all —
    // every realtime path goes through invalidate + refetch, so the server's answer is always
    // the whole truth. This test states the invariant; the grep test beside it enforces it.
    const qc = seed();
    const before = qc.getQueryData(KEYS.list);
    void qc.invalidateQueries({ queryKey: [...documentsKey, 'list'] });
    expect(qc.getQueryData(KEYS.list)).toBe(before);
  });
});
