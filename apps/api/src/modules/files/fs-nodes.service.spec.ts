import { describe, expect, it, vi } from 'vitest';
import { FsNodesService } from './fs-nodes.service';

function selectChain(result: unknown[]) {
  const obj: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'orderBy', 'limit', 'offset', 'innerJoin', 'leftJoin']) {
    obj[m] = () => obj;
  }
  obj['then'] = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej);
  return obj;
}

function makeService(opts: { selectResults?: unknown[][]; aclCheck?: boolean } = {}) {
  const queue = [...(opts.selectResults ?? [])];
  const db = {
    select: vi.fn(() => selectChain(queue.shift() ?? [])),
  };
  const acl = { check: vi.fn().mockResolvedValue(opts.aclCheck ?? false), grant: vi.fn() };
  const audit = { log: vi.fn() };
  const storage = { getDownloadUrl: vi.fn() };
  const service = new FsNodesService(db as never, acl as never, audit as never, storage as never);
  return { service, db, acl };
}

const baseNode = {
  id: 'n1',
  parentId: null,
  kind: 'folder' as const,
  name: 'Docs',
  space: 'personal' as const,
  ownerUserId: 'owner1',
  ownerOrgUnitId: null,
  currentVersionId: null,
  sizeCached: 0,
  mime: null,
  tags: [],
  starredBy: [],
  path: 'n1',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
  createdBy: 'owner1',
};

const user = { id: 'owner1', isSuperadmin: false } as never;

describe('FsNodesService.assertAccess', () => {
  it('allows a superadmin regardless of ownership', async () => {
    const { service } = makeService();
    await expect(
      service.assertAccess(
        { ...baseNode, ownerUserId: 'someone-else' },
        { id: 'other', isSuperadmin: true } as never,
        'manager',
      ),
    ).resolves.toBeUndefined();
  });

  it('allows the owner of a personal-space node', async () => {
    const { service } = makeService();
    await expect(service.assertAccess(baseNode, user, 'manager')).resolves.toBeUndefined();
  });

  it('denies a non-owner with no ACL grant on a personal node', async () => {
    const { service } = makeService({ aclCheck: false });
    await expect(
      service.assertAccess({ ...baseNode, ownerUserId: 'someone-else' }, user, 'viewer'),
    ).rejects.toMatchObject({ code: 'files.node.access_denied' });
  });

  it('allows org-space access via an ACL grant on the tree root', async () => {
    const { service, acl } = makeService({ aclCheck: true });
    const orgNode = {
      ...baseNode,
      space: 'org' as const,
      ownerUserId: null,
      ownerOrgUnitId: 'ou1',
      path: 'root1.n1',
    };
    await expect(service.assertAccess(orgNode, user, 'editor')).resolves.toBeUndefined();
    expect(acl.check).toHaveBeenCalledWith(user, 'folder', 'root1', 'editor');
  });

  it('denies org-space access when the ACL check fails', async () => {
    const { service } = makeService({ aclCheck: false });
    const orgNode = {
      ...baseNode,
      space: 'org' as const,
      ownerUserId: null,
      ownerOrgUnitId: 'ou1',
      path: 'root1.n1',
    };
    await expect(service.assertAccess(orgNode, user, 'viewer')).rejects.toMatchObject({
      code: 'files.node.access_denied',
    });
  });
});

describe('FsNodesService quota math', () => {
  it('reports the platform default quota when the user has no override', async () => {
    const { service } = makeService({
      selectResults: [[{ total: '1000' }], [{ quotaBytes: null }]],
    });
    const quota = await service.usage('personal', 'u1', null);
    expect(quota).toEqual({ usedBytes: 1000, quotaBytes: 10 * 1024 ** 3 });
  });

  it('reports unlimited (null) org quota when unset', async () => {
    const { service } = makeService({
      selectResults: [[{ total: null }], [{ quotaBytes: null }]],
    });
    const quota = await service.usage('org', null, 'ou1');
    expect(quota).toEqual({ usedBytes: 0, quotaBytes: null });
  });

  it('rejects a quota-exceeding upload', async () => {
    const { service } = makeService({
      selectResults: [[{ total: '9000000000' }], [{ quotaBytes: 10_000_000_000 }]],
    });
    await expect(service.assertQuota('personal', 'u1', null, 2_000_000_000)).rejects.toMatchObject({
      code: 'files.quota.exceeded',
    });
  });

  it('never rejects for system space (no quota applies)', async () => {
    const { service } = makeService();
    await expect(
      service.assertQuota('system', null, null, Number.MAX_SAFE_INTEGER),
    ).resolves.toBeUndefined();
  });

  it('clamps remainingBytes at 0 for an already-over-quota space', async () => {
    const { service } = makeService({
      selectResults: [[{ total: '11000000000' }], [{ quotaBytes: 10_000_000_000 }]],
    });
    const dto = await service.getQuota('personal', undefined, user);
    expect(dto.remainingBytes).toBe(0);
  });
});

describe('FsNodesService.assertNoSibling', () => {
  it('throws when a case-insensitive name match exists', async () => {
    const { service } = makeService({ selectResults: [[{ id: 'existing' }]] });
    await expect(
      service.assertNoSibling(null, 'personal', 'u1', null, 'Report.pdf'),
    ).rejects.toMatchObject({ code: 'files.node.name_exists' });
  });

  it('passes when no sibling matches', async () => {
    const { service } = makeService({ selectResults: [[]] });
    await expect(
      service.assertNoSibling(null, 'personal', 'u1', null, 'Report.pdf'),
    ).resolves.toBeUndefined();
  });
});

describe('FsNodesService.toDto', () => {
  it('maps a node row to its DTO shape, including null deletedAt', () => {
    const { service } = makeService();
    const dto = service.toDto(baseNode);
    expect(dto).toMatchObject({ id: 'n1', kind: 'folder', deletedAt: null, sizeCached: 0 });
    expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
