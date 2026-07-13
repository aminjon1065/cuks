import { describe, expect, it, vi } from 'vitest';
import { FileSharingService } from './file-sharing.service';
import type { FsNode } from './fs-nodes.service';

/** Minimal thenable query-builder stub: every chained method returns itself and
 *  awaiting resolves to the queued result. `select` pulls the next result off a
 *  FIFO queue so a test can script a sequence of queries. */
function chain(result: unknown[]) {
  const obj: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'innerJoin', 'limit']) obj[m] = () => obj;
  obj['then'] = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
  return obj;
}

const folderNode: FsNode = {
  id: 'n1',
  parentId: null,
  kind: 'folder',
  name: 'Reports',
  space: 'personal',
  ownerUserId: 'owner1',
  ownerOrgUnitId: null,
  currentVersionId: null,
  sizeCached: 0,
  mime: null,
  tags: [],
  starredBy: [],
  path: 'n1',
  searchTsv: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
  createdBy: 'owner1',
};

const owner = { id: 'owner1', isSuperadmin: false, permissions: [] } as never;
const stranger = { id: 'stranger', isSuperadmin: false, permissions: [] } as never;

function make(opts: { selectResults?: unknown[][]; node?: FsNode; hasAccess?: boolean } = {}) {
  const queue = [...(opts.selectResults ?? [])];
  const insertReturning = vi.fn();
  const deleteReturning = vi.fn();
  const insertOnConflict = vi.fn().mockResolvedValue(undefined);
  const db = {
    select: vi.fn(() => chain(queue.shift() ?? [])),
    selectDistinct: vi.fn(() => chain(queue.shift() ?? [])),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({ returning: insertReturning, onConflictDoNothing: insertOnConflict })),
    })),
    delete: vi.fn(() => ({ where: vi.fn(() => ({ returning: deleteReturning })) })),
  };
  const nodes = {
    requireNode: vi.fn().mockResolvedValue(opts.node ?? folderNode),
    hasAccess: vi.fn().mockResolvedValue(opts.hasAccess ?? false),
    toDto: vi.fn((n: { id: string }) => ({ id: n.id })),
  };
  const acl = {
    grant: vi
      .fn()
      .mockResolvedValue({ id: 'acl1', subjectType: 'user', subjectId: 'u2', level: 'viewer' }),
    revoke: vi.fn().mockResolvedValue(undefined),
    resolveUserSubjects: vi.fn().mockResolvedValue({ roleIds: [], orgUnitIds: [] }),
  };
  const scope = {
    getAccessibleOrgUnits: vi.fn().mockResolvedValue({ global: false, orgUnitIds: [] }),
  };
  const audit = { log: vi.fn() };
  const notifications = { notify: vi.fn().mockResolvedValue(undefined) };
  const service = new FileSharingService(
    db as never,
    nodes as never,
    acl as never,
    scope as never,
    audit as never,
    notifications as never,
  );
  return {
    service,
    db,
    nodes,
    acl,
    scope,
    audit,
    notifications,
    insertReturning,
    deleteReturning,
    insertOnConflict,
  };
}

describe('FileSharingService.grantAcl', () => {
  it('grants and notifies a directly-shared user (personal owner may manage)', async () => {
    const { service, acl, notifications } = make({
      selectResults: [[{ id: 'u2' }]], // assertSubjectExists lookup
    });
    await service.grantAcl('n1', { subjectType: 'user', subjectId: 'u2', level: 'viewer' }, owner);
    expect(acl.grant).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'folder',
        resourceId: 'n1',
        subjectType: 'user',
        subjectId: 'u2',
        level: 'viewer',
      }),
      'owner1',
    );
    expect(notifications.notify).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u2', type: 'files.file.shared' }),
    );
  });

  it('does not notify for an org_unit or role subject (no member fan-out)', async () => {
    const { service, notifications } = make({ selectResults: [[{ id: 'ou1' }]] });
    await service.grantAcl(
      'n1',
      { subjectType: 'org_unit', subjectId: 'ou1', level: 'editor' },
      owner,
    );
    expect(notifications.notify).not.toHaveBeenCalled();
  });

  it('rejects a stranger who cannot manage the node', async () => {
    const { service } = make({ hasAccess: false });
    await expect(
      service.grantAcl('n1', { subjectType: 'user', subjectId: 'u2', level: 'viewer' }, stranger),
    ).rejects.toMatchObject({ code: 'files.share.forbidden' });
  });

  it('rejects granting to a non-existent subject', async () => {
    const { service } = make({ selectResults: [[]] }); // assertSubjectExists → empty
    await expect(
      service.grantAcl('n1', { subjectType: 'user', subjectId: 'ghost', level: 'viewer' }, owner),
    ).rejects.toMatchObject({ code: 'files.share.subject_not_found' });
  });

  it("refuses to change (downgrade/escalate) an org root's own unit grant via PUT", async () => {
    const orgRoot = {
      ...folderNode,
      space: 'org' as const,
      ownerUserId: null,
      ownerOrgUnitId: 'ou1',
      parentId: null,
    };
    const { service, acl } = make({ node: orgRoot, hasAccess: true });
    await expect(
      service.grantAcl('n1', { subjectType: 'org_unit', subjectId: 'ou1', level: 'viewer' }, owner),
    ).rejects.toMatchObject({ code: 'files.share.root_grant_protected' });
    expect(acl.grant).not.toHaveBeenCalled();
  });

  it('lets a files.org.manage holder scoped to the owning unit manage an org node', async () => {
    const orgNode = {
      ...folderNode,
      id: 'orgfolder',
      space: 'org' as const,
      ownerUserId: null,
      ownerOrgUnitId: 'ou1',
      parentId: 'orgroot',
      path: 'orgroot.orgfolder',
    };
    const orgUser = { id: 'mgr', isSuperadmin: false, permissions: ['files.org.manage'] } as never;
    const { service, scope, acl } = make({
      node: orgNode,
      hasAccess: false,
      selectResults: [[{ id: 'u2' }]],
    });
    scope.getAccessibleOrgUnits.mockResolvedValue({ global: false, orgUnitIds: ['ou1'] });
    await service.grantAcl(
      'orgfolder',
      { subjectType: 'user', subjectId: 'u2', level: 'viewer' },
      orgUser,
    );
    expect(scope.getAccessibleOrgUnits).toHaveBeenCalledWith(orgUser, 'files.org.manage');
    expect(acl.grant).toHaveBeenCalled();
  });

  it('rejects a files.org.manage holder scoped to a DIFFERENT unit (cross-unit escalation)', async () => {
    const orgNode = {
      ...folderNode,
      id: 'orgfolder',
      space: 'org' as const,
      ownerUserId: null,
      ownerOrgUnitId: 'ou1',
      parentId: 'orgroot',
      path: 'orgroot.orgfolder',
    };
    const orgUser = { id: 'mgr', isSuperadmin: false, permissions: ['files.org.manage'] } as never;
    const { service, scope } = make({ node: orgNode, hasAccess: false });
    scope.getAccessibleOrgUnits.mockResolvedValue({ global: false, orgUnitIds: ['ou-OTHER'] });
    await expect(
      service.grantAcl(
        'orgfolder',
        { subjectType: 'user', subjectId: 'u2', level: 'viewer' },
        orgUser,
      ),
    ).rejects.toMatchObject({ code: 'files.share.forbidden' });
  });
});

describe('FileSharingService.revokeAcl', () => {
  it("refuses to strip an org root's own unit grant", async () => {
    const orgRoot = {
      ...folderNode,
      space: 'org' as const,
      ownerUserId: null,
      ownerOrgUnitId: 'ou1',
      parentId: null,
    };
    const { service } = make({ node: orgRoot, hasAccess: true });
    await expect(
      service.revokeAcl('n1', { subjectType: 'org_unit', subjectId: 'ou1' }, owner),
    ).rejects.toMatchObject({ code: 'files.share.root_grant_protected' });
  });

  it('revokes an existing grant', async () => {
    const { service, acl } = make({
      hasAccess: true,
      selectResults: [[{ id: 'acl-row-1' }]], // the acl row lookup
    });
    await service.revokeAcl('n1', { subjectType: 'user', subjectId: 'u2' }, owner);
    expect(acl.revoke).toHaveBeenCalledWith('acl-row-1', 'owner1');
  });

  it('404s revoking a grant that does not exist', async () => {
    const { service } = make({ hasAccess: true, selectResults: [[]] });
    await expect(
      service.revokeAcl('n1', { subjectType: 'user', subjectId: 'u2' }, owner),
    ).rejects.toMatchObject({ code: 'files.share.not_found' });
  });
});

describe('FileSharingService.createLink', () => {
  it('mints a token and stores a link with a computed expiry', async () => {
    const { service, insertReturning } = make();
    insertReturning.mockResolvedValue([
      {
        id: 'link1',
        nodeId: 'n1',
        token: 'tok',
        expiresAt: new Date('2026-02-01T00:00:00Z'),
        createdBy: 'owner1',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
    const dto = await service.createLink('n1', 7, owner);
    expect(dto.token).toBe('tok');
    expect(dto.url).toContain('tok');
    expect(dto.expiresAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('rejects a stranger', async () => {
    const { service } = make({ hasAccess: false });
    await expect(service.createLink('n1', null, stranger)).rejects.toMatchObject({
      code: 'files.share.forbidden',
    });
  });
});

describe('FileSharingService.acceptLink', () => {
  const link = {
    id: 'link1',
    nodeId: 'n1',
    token: 'tok',
    expiresAt: null,
    createdBy: 'owner1',
    createdAt: new Date(),
  };

  it('404s an unknown token', async () => {
    const { service } = make({ selectResults: [[]] });
    await expect(service.acceptLink('nope', stranger)).rejects.toMatchObject({
      code: 'files.link.not_found',
    });
  });

  it('rejects an expired link', async () => {
    const { service } = make({
      selectResults: [[{ ...link, expiresAt: new Date('2020-01-01T00:00:00Z') }]],
    });
    await expect(service.acceptLink('tok', stranger)).rejects.toMatchObject({
      code: 'files.link.expired',
    });
  });

  it('records a live link grant (not a permanent ACL row), then returns the node', async () => {
    const { service, acl, nodes, db, insertOnConflict } = make({
      selectResults: [[link]],
      hasAccess: false,
    });
    const dto = await service.acceptLink('tok', stranger);
    expect(nodes.requireNode).toHaveBeenCalledWith('n1');
    // Must NOT write a permanent resource_acl grant — that would survive link
    // revoke/expiry (the review finding).
    expect(acl.grant).not.toHaveBeenCalled();
    expect(db.insert).toHaveBeenCalled();
    expect(insertOnConflict).toHaveBeenCalled();
    expect(dto).toEqual({ id: 'n1' });
  });
});

describe('FileSharingService.listSharedWithMe', () => {
  it('unions ACL + link grants, excludes owned/membership-root nodes, and dedups to top-most', async () => {
    const sharedFolder = {
      ...folderNode,
      id: 'shared-root',
      path: 'shared-root',
      ownerUserId: 'other',
    };
    const sharedChild = {
      ...folderNode,
      id: 'child',
      path: 'shared-root.child',
      ownerUserId: 'other',
    };
    const linkNode = { ...folderNode, id: 'link-node', path: 'link-node', ownerUserId: 'other' };
    const myOwnNode = { ...folderNode, id: 'mine', path: 'mine', ownerUserId: 'owner1' };
    const membershipRoot = {
      ...folderNode,
      id: 'orgroot',
      path: 'orgroot',
      space: 'org' as const,
      ownerUserId: null,
      ownerOrgUnitId: 'ou1',
      parentId: null,
    };
    const { service, acl } = make({
      selectResults: [
        // aclRows (selectDistinct resourceAcl.resourceId)
        [{ id: 'shared-root' }, { id: 'child' }, { id: 'mine' }, { id: 'orgroot' }],
        // linkRows (selectDistinct fileLinkGrants.nodeId, active links)
        [{ id: 'link-node' }],
        // nodeRows (select fsNodes where id in [...])
        [sharedFolder, sharedChild, linkNode, myOwnNode, membershipRoot],
      ],
    });
    acl.resolveUserSubjects.mockResolvedValue({ roleIds: [], orgUnitIds: ['ou1'] });

    const result = await service.listSharedWithMe(owner);
    // Top-most shared folder + the link-granted node survive; child is nested
    // under shared-root, myOwnNode is owned, membershipRoot is "Общие".
    expect(result.map((r) => r.id).sort()).toEqual(['link-node', 'shared-root']);
  });

  it('returns empty when nothing is shared (no ACL, no link grants)', async () => {
    const { service } = make({ selectResults: [[], []] });
    expect(await service.listSharedWithMe(owner)).toEqual([]);
  });
});
