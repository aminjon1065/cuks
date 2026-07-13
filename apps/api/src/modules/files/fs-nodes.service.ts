import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, ne, sql, sum } from 'drizzle-orm';
import { fileVersions, fsNodes, orgUnits, users, type Database } from '@cuks/db';
import {
  DEFAULT_PERSONAL_QUOTA_BYTES,
  type AclLevel,
  type BreadcrumbDto,
  type FsNodeDto,
  type FsSpace,
  type QuotaDto,
} from '@cuks/shared';
import { uuidv7 } from 'uuidv7';
import { AclService } from '../admin/acl.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { StorageService } from '../../common/storage/storage.service';
import { DB } from '../../common/db/db.module';

type FsNode = typeof fsNodes.$inferSelect;

/** Concurrent moves are serialized so the cycle guard can't be invalidated. */
const MOVE_LOCK_KEY = 4242002;

export interface ResolvedTarget {
  parent: FsNode | null;
  ownerUserId: string | null;
  ownerOrgUnitId: string | null;
}

/**
 * fs_nodes core: tree/breadcrumbs, access control, quotas (docs/modules/12 §2-4).
 * Scope note (task 1.2, docs/plan/STATUS.md): access is ownership (personal) or an
 * ACL check against the org's auto-provisioned root folder (org) — the existing
 * `AclService`/`resource_acl` machinery from 0.5, not a parallel mechanism. Per-
 * folder sharing UI/endpoints are task 1.4; this only needs the check to already work.
 */
@Injectable()
export class FsNodesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly acl: AclService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async requireNode(id: string, db: Database = this.db): Promise<FsNode> {
    const [node] = await db
      .select()
      .from(fsNodes)
      .where(and(eq(fsNodes.id, id), isNull(fsNodes.deletedAt)))
      .limit(1);
    if (!node) throw AppException.notFound('files.node.not_found', 'File or folder not found');
    return node;
  }

  /** Lazily provisions an org unit's root folder, granting it `editor` ACL access
   *  (docs/modules/12 §2: "корень на подразделение создаётся автоматически").
   *  Authorizes *before* writing anything — provisioning creates real state (a node
   *  + an ACL grant), so doing it for an unrelated caller would be write
   *  amplification and an org-unit-existence oracle via the 404-vs-403 status. The
   *  node insert and ACL grant are one transaction so a failure between them can't
   *  permanently strand an org unit with a root nobody has access to. */
  async ensureOrgRoot(orgUnitId: string, user: AuthUser): Promise<FsNode> {
    const [existing] = await this.db
      .select()
      .from(fsNodes)
      .where(
        and(
          eq(fsNodes.space, 'org'),
          eq(fsNodes.ownerOrgUnitId, orgUnitId),
          isNull(fsNodes.parentId),
        ),
      )
      .limit(1);
    if (existing) return existing;

    if (!user.isSuperadmin) {
      const { orgUnitIds } = await this.acl.resolveUserSubjects(user.id);
      if (!orgUnitIds.includes(orgUnitId)) {
        throw AppException.forbidden(
          'files.node.access_denied',
          "No access to this org unit's files",
        );
      }
    }

    const [orgUnit] = await this.db
      .select({ name: orgUnits.name })
      .from(orgUnits)
      .where(eq(orgUnits.id, orgUnitId))
      .limit(1);
    if (!orgUnit) throw AppException.notFound('files.org_unit.not_found', 'Org unit not found');

    const id = uuidv7();
    return this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(fsNodes)
        .values({
          id,
          parentId: null,
          kind: 'folder',
          name: orgUnit.name,
          space: 'org',
          ownerOrgUnitId: orgUnitId,
          path: id,
          createdBy: user.id,
        })
        .onConflictDoNothing()
        .returning();
      if (created) {
        await this.acl.grant(
          {
            resourceType: 'folder',
            resourceId: id,
            subjectType: 'org_unit',
            subjectId: orgUnitId,
            level: 'editor',
          },
          user.id,
          tx,
        );
        return created;
      }
      // Lost the create race to a concurrent request — fetch what they created.
      const [winner] = await tx
        .select()
        .from(fsNodes)
        .where(and(eq(fsNodes.space, 'org'), eq(fsNodes.ownerOrgUnitId, orgUnitId)))
        .limit(1);
      if (!winner) throw new Error('failed to provision or find the org root folder');
      return winner;
    });
  }

  /** Personal space: ownership. Org space: ACL check on the tree's root folder
   *  (its id is always the first path segment). Falls back to a direct ACL grant
   *  on the node itself for future per-item sharing (task 1.4). */
  async assertAccess(node: FsNode, user: AuthUser, minLevel: AclLevel): Promise<void> {
    if (user.isSuperadmin) return;
    if (node.space === 'personal' && node.ownerUserId === user.id) return;
    if (node.space === 'org') {
      const rootId = node.path.split('.')[0]!;
      if (await this.acl.check(user, 'folder', rootId, minLevel)) return;
    }
    if (await this.acl.check(user, node.kind, node.id, minLevel)) return;
    throw AppException.forbidden('files.node.access_denied', 'No access to this file or folder');
  }

  /** Resolves a create/upload target from `(space, parentId?, orgUnitId?)`: the
   *  parent node (null = personal root) and the owner fields new siblings inherit. */
  async resolveTarget(
    space: FsSpace,
    parentId: string | null,
    orgUnitId: string | undefined,
    user: AuthUser,
  ): Promise<ResolvedTarget> {
    if (space === 'personal') {
      if (!parentId) return { parent: null, ownerUserId: user.id, ownerOrgUnitId: null };
      const parent = await this.requireNode(parentId);
      if (parent.space !== 'personal') {
        throw AppException.badRequest(
          'files.node.space_mismatch',
          'Parent is not in personal space',
        );
      }
      return { parent, ownerUserId: parent.ownerUserId, ownerOrgUnitId: null };
    }
    if (space === 'org') {
      if (parentId) {
        const parent = await this.requireNode(parentId);
        if (parent.space !== 'org') {
          throw AppException.badRequest('files.node.space_mismatch', 'Parent is not in org space');
        }
        return { parent, ownerUserId: null, ownerOrgUnitId: parent.ownerOrgUnitId };
      }
      if (!orgUnitId) {
        throw AppException.badRequest(
          'files.node.org_unit_required',
          'orgUnitId is required when parentId is omitted for org space',
        );
      }
      const parent = await this.ensureOrgRoot(orgUnitId, user);
      return { parent, ownerUserId: null, ownerOrgUnitId: orgUnitId };
    }
    throw AppException.badRequest(
      'files.node.system_space_unsupported',
      'Cannot create nodes directly in system space',
    );
  }

  /** Case-insensitive exact-name collision among active siblings (docs/plan/
   *  STATUS.md 1.2: a service-level check, not a DB constraint — see decision). */
  async assertNoSibling(
    parentId: string | null,
    space: FsSpace,
    ownerUserId: string | null,
    ownerOrgUnitId: string | null,
    name: string,
    excludeId?: string,
  ): Promise<void> {
    const conds = [
      isNull(fsNodes.deletedAt),
      eq(fsNodes.space, space),
      sql`lower(${fsNodes.name}) = lower(${name})`,
      parentId ? eq(fsNodes.parentId, parentId) : isNull(fsNodes.parentId),
    ];
    if (space === 'personal' && ownerUserId) conds.push(eq(fsNodes.ownerUserId, ownerUserId));
    if (space === 'org' && ownerOrgUnitId) conds.push(eq(fsNodes.ownerOrgUnitId, ownerOrgUnitId));
    if (excludeId) conds.push(ne(fsNodes.id, excludeId));
    const [existing] = await this.db
      .select({ id: fsNodes.id })
      .from(fsNodes)
      .where(and(...conds))
      .limit(1);
    if (existing) {
      throw AppException.badRequest(
        'files.node.name_exists',
        'A file or folder with this name already exists here',
      );
    }
  }

  async breadcrumbsFor(path: string, db: Database = this.db): Promise<BreadcrumbDto[]> {
    const ids = path.split('.');
    const rows = await db
      .select({ id: fsNodes.id, name: fsNodes.name })
      .from(fsNodes)
      .where(inArray(fsNodes.id, ids));
    const byId = new Map(rows.map((r) => [r.id, r.name]));
    return ids.map((id) => ({ id, name: byId.get(id) ?? '?' }));
  }

  async getDownloadUrl(id: string, user: AuthUser): Promise<string> {
    const node = await this.requireNode(id);
    await this.assertAccess(node, user, 'viewer');
    if (node.kind !== 'file' || !node.currentVersionId) {
      throw AppException.badRequest('files.node.not_a_file', 'Not a downloadable file');
    }
    const [version] = await this.db
      .select({ storageKey: fileVersions.storageKey })
      .from(fileVersions)
      .where(eq(fileVersions.id, node.currentVersionId))
      .limit(1);
    if (!version) throw new Error('current_version_id points to a missing file_versions row');
    this.audit.log({
      action: 'files.file.downloaded',
      actorId: user.id,
      entityType: 'file',
      entityId: id,
    });
    return this.storage.getDownloadUrl(version.storageKey, node.name);
  }

  /** Live SUM over `size_cached` — trashed files still occupy storage, so they
   *  still count (docs/plan/STATUS.md 1.2 decision). No maintained counter yet. */
  async usage(
    space: 'personal' | 'org',
    ownerUserId: string | null,
    ownerOrgUnitId: string | null,
  ): Promise<{ usedBytes: number; quotaBytes: number | null }> {
    if (space === 'personal') {
      const [row] = await this.db
        .select({ total: sum(fsNodes.sizeCached) })
        .from(fsNodes)
        .where(
          and(
            eq(fsNodes.space, 'personal'),
            eq(fsNodes.ownerUserId, ownerUserId!),
            eq(fsNodes.kind, 'file'),
          ),
        );
      const [u] = await this.db
        .select({ quotaBytes: users.quotaBytes })
        .from(users)
        .where(eq(users.id, ownerUserId!))
        .limit(1);
      return {
        usedBytes: Number(row?.total ?? 0),
        quotaBytes: u?.quotaBytes ?? DEFAULT_PERSONAL_QUOTA_BYTES,
      };
    }
    const [row] = await this.db
      .select({ total: sum(fsNodes.sizeCached) })
      .from(fsNodes)
      .where(
        and(
          eq(fsNodes.space, 'org'),
          eq(fsNodes.ownerOrgUnitId, ownerOrgUnitId!),
          eq(fsNodes.kind, 'file'),
        ),
      );
    const [ou] = await this.db
      .select({ quotaBytes: orgUnits.quotaBytes })
      .from(orgUnits)
      .where(eq(orgUnits.id, ownerOrgUnitId!))
      .limit(1);
    return { usedBytes: Number(row?.total ?? 0), quotaBytes: ou?.quotaBytes ?? null };
  }

  async assertQuota(
    space: FsSpace,
    ownerUserId: string | null,
    ownerOrgUnitId: string | null,
    additionalBytes: number,
  ): Promise<void> {
    if (space === 'system') return;
    const { usedBytes, quotaBytes } = await this.usage(space, ownerUserId, ownerOrgUnitId);
    if (quotaBytes !== null && usedBytes + additionalBytes > quotaBytes) {
      throw AppException.unprocessable('files.quota.exceeded', 'Storage quota exceeded', {
        usedBytes,
        quotaBytes,
        additionalBytes,
      });
    }
  }

  async getQuota(
    space: 'personal' | 'org',
    orgUnitId: string | undefined,
    user: AuthUser,
  ): Promise<QuotaDto> {
    const ownerUserId = space === 'personal' ? user.id : null;
    const ownerOrgUnitId = space === 'org' ? (orgUnitId ?? null) : null;
    if (space === 'org') {
      if (!ownerOrgUnitId) {
        throw AppException.badRequest('files.quota.org_unit_required', 'orgUnitId is required');
      }
      const root = await this.ensureOrgRoot(ownerOrgUnitId, user);
      await this.assertAccess(root, user, 'viewer');
    }
    const { usedBytes, quotaBytes } = await this.usage(space, ownerUserId, ownerOrgUnitId);
    return {
      usedBytes,
      quotaBytes,
      remainingBytes: quotaBytes === null ? null : Math.max(0, quotaBytes - usedBytes),
    };
  }

  toDto(node: FsNode): FsNodeDto {
    return {
      id: node.id,
      parentId: node.parentId,
      kind: node.kind,
      name: node.name,
      space: node.space,
      ownerUserId: node.ownerUserId,
      ownerOrgUnitId: node.ownerOrgUnitId,
      currentVersionId: node.currentVersionId,
      sizeCached: node.sizeCached,
      mime: node.mime,
      tags: node.tags,
      starredBy: node.starredBy,
      path: node.path,
      deletedAt: node.deletedAt?.toISOString() ?? null,
      createdAt: node.createdAt.toISOString(),
      updatedAt: node.updatedAt.toISOString(),
    };
  }
}

export { MOVE_LOCK_KEY };
export type { FsNode };
