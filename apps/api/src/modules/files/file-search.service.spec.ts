import { describe, expect, it, vi } from 'vitest';
import { FileSearchService } from './file-search.service';

/** Minimal awaitable query-builder stub: every chain method returns the same
 *  object, which resolves to the next queued result set when awaited. */
function thenable(getResult: () => unknown[]) {
  const obj: Record<string, unknown> = {};
  for (const m of ['from', 'leftJoin', 'innerJoin', 'where', 'orderBy', 'limit']) {
    obj[m] = () => obj;
  }
  obj.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(getResult()).then(res, rej);
  return obj;
}

function makeService(selectResults: unknown[][], executeRows: unknown[] = []) {
  const queue = [...selectResults];
  const next = (): unknown[] => queue.shift() ?? [];
  const db = {
    select: vi.fn(() => thenable(next)),
    selectDistinct: vi.fn(() => thenable(next)),
    // Phase-1 candidate query returns a pg-style { rows }.
    execute: vi.fn(() => Promise.resolve({ rows: executeRows })),
  };
  const acl = {
    resolveUserSubjects: vi.fn().mockResolvedValue({ roleIds: [], orgUnitIds: [] }),
  };
  const service = new FileSearchService(db as never, acl as never);
  return { service, db, acl };
}

const superadmin = { id: 'admin', isSuperadmin: true } as never;
const member = { id: 'u1', isSuperadmin: false } as never;

const fileRow = (over: Record<string, unknown> = {}) => ({
  id: 'f1',
  parentId: 'folder1',
  kind: 'file',
  name: 'doc.txt',
  space: 'personal',
  ownerUserId: 'u1',
  ownerOrgUnitId: null,
  currentVersionId: 'v1',
  sizeCached: 10,
  mime: 'text/plain',
  tags: [],
  starredBy: [],
  path: 'folder1.f1',
  deletedAt: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  avStatus: 'clean',
  ...over,
});

describe('FileSearchService.search', () => {
  it('short-circuits a blank query without touching the database', async () => {
    const { service, db, acl } = makeService([]);
    const out = await service.search('   ', 50, member);
    expect(out).toEqual([]);
    expect(db.select).not.toHaveBeenCalled();
    expect(acl.resolveUserSubjects).not.toHaveBeenCalled();
  });

  it('maps a hit to a SearchResultDto with avStatus and a location breadcrumb', async () => {
    // superadmin scope skips the grant lookups. Phase-1 execute returns the ranked
    // id; then [hydrateRows, locationNames] come from select().
    const { service, acl } = makeService(
      [[fileRow()], [{ id: 'folder1', name: 'Reports' }]],
      [{ id: 'f1', rank: 0.5 }],
    );
    const out = await service.search('doc', 50, superadmin);
    expect(acl.resolveUserSubjects).not.toHaveBeenCalled(); // superadmin: no scope query
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'f1',
      name: 'doc.txt',
      avStatus: 'clean',
      location: 'Reports',
    });
    // Dates are serialized to ISO strings in the DTO.
    expect(out[0]?.updatedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('resolves the access scope for a non-superadmin before querying', async () => {
    // select queue: [aclGrants, linkGrants, grantedPaths, hydrateRows, locationNames];
    // execute (phase 1) returns the ranked id.
    const { service, acl } = makeService(
      [
        [{ id: 'g1' }],
        [],
        [{ path: 'g1' }],
        [fileRow({ path: 'g1.f1' })],
        [{ id: 'g1', name: 'Shared' }],
      ],
      [{ id: 'f1', rank: 0.5 }],
    );
    const out = await service.search('doc', 50, member);
    expect(acl.resolveUserSubjects).toHaveBeenCalledWith('u1');
    expect(out).toHaveLength(1);
    expect(out[0]?.location).toBe('Shared');
  });
});

describe('FileSearchService.recent', () => {
  it('maps recent rows to nodes with their avStatus', async () => {
    // non-superadmin, no grants: [aclGrants, linkGrants, mainRows]
    const { service } = makeService([[], [], [fileRow({ avStatus: 'pending' })]]);
    const out = await service.recent(30, member);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: 'f1', avStatus: 'pending' });
  });
});
