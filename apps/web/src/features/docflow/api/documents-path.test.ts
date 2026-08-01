import { describe, expect, it } from 'vitest';
import { listDocumentsQuerySchema, type ListDocumentsQuery } from '@cuks/shared';
import { documentsPath } from './queries';

/**
 * The register's URL builder, tested against the DTO's OWN key list rather than a hand-written
 * one.
 *
 * The bug this exists for was silent and assertive at once: `overdue` and `awaitingDispatch`
 * were accepted by the DTO, implemented by the server and rendered by the screen as chips —
 * and dropped here, so the dashboard's «Просрочено: 3» opened the whole register with a chip
 * above it claiming a filter that was never sent. Nothing failed; the page simply lied.
 *
 * Walking the schema's keys means the next filter added to the DTO fails this test until it is
 * serialised, instead of being discovered on a screen months later.
 */
const FULL: ListDocumentsQuery = {
  page: 2,
  limit: 25,
  queue: 'registry',
  status: 'registered',
  docClass: 'incoming',
  journalId: '019f5a56-741d-7347-8c6d-3b62cedea149',
  search: 'наводнение',
  year: 2026,
  sort: '-reg_date',
  overdue: true,
  awaitingDispatch: true,
};

/** Filters that are meaningless when false/absent and so are legitimately omitted. */
const OMITTED_WHEN_FALSY = new Set(['overdue', 'awaitingDispatch']);

describe('documentsPath', () => {
  it('serialises every key the list DTO accepts', () => {
    const url = new URL(documentsPath(FULL), 'http://x');
    for (const key of Object.keys(listDocumentsQuerySchema.shape)) {
      expect(url.searchParams.get(key), `«${key}» reaches the API`).not.toBeNull();
    }
  });

  it('sends the values it was given, not defaults', () => {
    const url = new URL(documentsPath(FULL), 'http://x');
    expect(url.searchParams.get('queue')).toBe('registry');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('search')).toBe('наводнение');
    expect(url.searchParams.get('year')).toBe('2026');
    expect(url.searchParams.get('sort')).toBe('-reg_date');
    expect(url.searchParams.get('overdue')).toBe('true');
    expect(url.searchParams.get('awaitingDispatch')).toBe('true');
  });

  it('omits the boolean filters when they are off, rather than sending false', () => {
    const url = new URL(
      documentsPath({ page: 1, limit: 50, queue: 'mine', overdue: false, awaitingDispatch: false }),
      'http://x',
    );
    for (const key of OMITTED_WHEN_FALSY) {
      expect(url.searchParams.has(key), `«${key}» is absent when off`).toBe(false);
    }
    // A bare query is still a valid one: paging and the queue always travel.
    expect(url.searchParams.get('queue')).toBe('mine');
    expect([...url.searchParams.keys()].sort()).toEqual(['limit', 'page', 'queue']);
  });
});
