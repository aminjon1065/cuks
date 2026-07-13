import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, or, type SQL } from 'drizzle-orm';
import {
  fileLinkGrants,
  fileLinks,
  fsNodes,
  orgUnits,
  resourceAcl,
  roles,
  users,
  type Database,
} from '@cuks/db';
import {
  FILE_LINK_TOKEN_BYTES,
  FILE_LINK_URL_PREFIX,
  type FileLinkDto,
  type FsNodeDto,
  type GrantNodeAclInput,
  type NodeAclEntryDto,
  type NodeAclResponse,
  type RevokeNodeAclInput,
} from '@cuks/shared';
import { AclService } from '../admin/acl.service';
import { ScopeService } from '../admin/scope.service';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { NotificationsService } from '../notifications/notifications.service';
import { DB } from '../../common/db/db.module';
import { FsNodesService, type FsNode } from './fs-nodes.service';

/**
 * File/folder sharing (docs/modules/12 §1, §3, task 1.4): per-node ACL grants
 * over the existing `resource_acl` machinery, and internal share links
 * (`file_links` + `file_link_grants`). Access enforcement itself lives in
 * `FsNodesService.assertAccess`/`hasAccess` (which walk ancestor grants and live
 * link grants) — this service is the management surface: who can grant, listing,
 * notifications, link tokens.
 */
@Injectable()
export class FileSharingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly nodes: FsNodesService,
    private readonly acl: AclService,
    private readonly scope: ScopeService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // --- ACL ---

  async getAcl(nodeId: string, user: AuthUser): Promise<NodeAclResponse> {
    const node = await this.nodes.requireNode(nodeId);
    await this.assertManage(node, user);

    const pathIds = node.path.split('.');
    const ancestorIds = pathIds.slice(0, -1); // strict ancestors (all folders)

    const directRows = await this.aclRowsFor([node.id]);
    const inheritedRows = ancestorIds.length ? await this.aclRowsFor(ancestorIds) : [];

    const entries = await Promise.all(directRows.map((r) => this.toAclEntry(r, false, null)));
    const inherited = await Promise.all(
      inheritedRows.map((r) => this.toAclEntry(r, true, r.resourceId)),
    );
    return { entries, inherited };
  }

  async grantAcl(
    nodeId: string,
    input: GrantNodeAclInput,
    user: AuthUser,
  ): Promise<NodeAclEntryDto> {
    const node = await this.nodes.requireNode(nodeId);
    await this.assertManage(node, user);
    // The org root's own unit grant is the unit's baseline access; changing its
    // level here would downgrade (break) or escalate the whole unit at once — so
    // it is off-limits to grant just as it is to revoke.
    if (this.isProtectedRootGrant(node, input.subjectType, input.subjectId)) {
      throw AppException.badRequest(
        'files.share.root_grant_protected',
        "The org unit's baseline access to its root folder cannot be changed here",
      );
    }
    await this.assertSubjectExists(input.subjectType, input.subjectId);

    const entry = await this.acl.grant(
      {
        resourceType: node.kind,
        resourceId: node.id,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        level: input.level,
      },
      user.id,
    );

    this.audit.log({
      action: 'files.node.shared',
      actorId: user.id,
      entityType: node.kind,
      entityId: node.id,
      meta: { subjectType: input.subjectType, subjectId: input.subjectId, level: input.level },
    });

    // Notify a directly-shared user (org-unit/role grants would fan out to every
    // member — deferred, docs/plan/STATUS.md 1.4 decision).
    if (input.subjectType === 'user' && input.subjectId !== user.id) {
      await this.notifications.notify({
        userId: input.subjectId,
        type: 'files.file.shared',
        title: 'Файл открыт для вас',
        body: `«${node.name}» открыт для вас (${input.level})`,
        entityType: node.kind,
        entityId: node.id,
      });
    }

    return this.toAclEntry(
      {
        id: entry.id,
        subjectType: entry.subjectType,
        subjectId: entry.subjectId,
        level: entry.level,
      },
      false,
      null,
    );
  }

  async revokeAcl(nodeId: string, input: RevokeNodeAclInput, user: AuthUser): Promise<void> {
    const node = await this.nodes.requireNode(nodeId);
    await this.assertManage(node, user);

    // Don't let anyone strip the org root's own unit grant — that is what makes
    // the whole shared space visible to its members (ensureOrgRoot's auto-grant).
    if (this.isProtectedRootGrant(node, input.subjectType, input.subjectId)) {
      throw AppException.badRequest(
        'files.share.root_grant_protected',
        "The org unit's own access to its root folder cannot be revoked",
      );
    }

    const [row] = await this.db
      .select({ id: resourceAcl.id })
      .from(resourceAcl)
      .where(
        and(
          eq(resourceAcl.resourceType, node.kind),
          eq(resourceAcl.resourceId, node.id),
          eq(resourceAcl.subjectType, input.subjectType),
          eq(resourceAcl.subjectId, input.subjectId),
        ),
      )
      .limit(1);
    if (!row) throw AppException.notFound('files.share.not_found', 'No such access grant');

    await this.acl.revoke(row.id, user.id);
    this.audit.log({
      action: 'files.node.unshared',
      actorId: user.id,
      entityType: node.kind,
      entityId: node.id,
      meta: { subjectType: input.subjectType, subjectId: input.subjectId },
    });
  }

  // --- Internal links ---

  async createLink(
    nodeId: string,
    expiresInDays: number | null | undefined,
    user: AuthUser,
  ): Promise<FileLinkDto> {
    const node = await this.nodes.requireNode(nodeId);
    await this.assertManage(node, user);

    const token = randomBytes(FILE_LINK_TOKEN_BYTES).toString('base64url');
    const expiresAt =
      expiresInDays != null ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000) : null;

    const [row] = await this.db
      .insert(fileLinks)
      .values({ nodeId: node.id, token, expiresAt, createdBy: user.id })
      .returning();

    this.audit.log({
      action: 'files.link.created',
      actorId: user.id,
      entityType: node.kind,
      entityId: node.id,
      meta: { linkId: row!.id, expiresAt: expiresAt?.toISOString() ?? null },
    });
    return this.toLinkDto(row!);
  }

  async listLinks(nodeId: string, user: AuthUser): Promise<FileLinkDto[]> {
    const node = await this.nodes.requireNode(nodeId);
    await this.assertManage(node, user);
    const rows = await this.db.select().from(fileLinks).where(eq(fileLinks.nodeId, node.id));
    return rows.map((r) => this.toLinkDto(r));
  }

  async revokeLink(nodeId: string, linkId: string, user: AuthUser): Promise<void> {
    const node = await this.nodes.requireNode(nodeId);
    await this.assertManage(node, user);
    const [removed] = await this.db
      .delete(fileLinks)
      .where(and(eq(fileLinks.id, linkId), eq(fileLinks.nodeId, node.id)))
      .returning();
    if (!removed) throw AppException.notFound('files.link.not_found', 'Link not found');
    this.audit.log({
      action: 'files.link.revoked',
      actorId: user.id,
      entityType: node.kind,
      entityId: node.id,
      meta: { linkId },
    });
  }

  /**
   * Resolve an internal link token: any authenticated `files.use` user holding a
   * valid, unexpired token records a `file_link_grants` row (viewer, enforced
   * live), so the node appears in their "Доступные мне" and downstream checks
   * work — but revoking OR expiring the link cuts that access, because it is NOT
   * a permanent resource_acl grant. Returns the node.
   */
  async acceptLink(token: string, user: AuthUser): Promise<FsNodeDto> {
    const [link] = await this.db
      .select()
      .from(fileLinks)
      .where(eq(fileLinks.token, token))
      .limit(1);
    if (!link) throw AppException.notFound('files.link.not_found', 'Link not found or revoked');
    if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) {
      throw AppException.badRequest('files.link.expired', 'This link has expired');
    }

    // requireNode already excludes soft-deleted nodes.
    const node = await this.nodes.requireNode(link.nodeId);

    // Idempotent per (link, user); does not touch resource_acl, so it never
    // downgrades a stronger explicit grant the user may already hold.
    await this.db
      .insert(fileLinkGrants)
      .values({ linkId: link.id, userId: user.id, nodeId: node.id })
      .onConflictDoNothing();

    this.audit.log({
      action: 'files.link.accessed',
      actorId: user.id,
      entityType: node.kind,
      entityId: node.id,
      meta: { linkId: link.id },
    });
    return this.nodes.toDto(node);
  }

  // --- "Доступные мне" ---

  /**
   * Nodes shared with the user via an explicit ACL grant on one of their
   * subjects (self / role / org unit) OR a still-valid internal-link grant they
   * accepted, excluding what they'd see anyway: their own personal nodes and the
   * membership org roots ("Общие"). Deduped to the top-most shared node — a
   * shared child under a shared ancestor is hidden.
   */
  async listSharedWithMe(user: AuthUser): Promise<FsNodeDto[]> {
    const { roleIds, orgUnitIds } = await this.acl.resolveUserSubjects(user.id);

    const subjectConds: SQL[] = [
      and(eq(resourceAcl.subjectType, 'user'), eq(resourceAcl.subjectId, user.id)) as SQL,
    ];
    if (roleIds.length) {
      subjectConds.push(
        and(eq(resourceAcl.subjectType, 'role'), inArray(resourceAcl.subjectId, roleIds)) as SQL,
      );
    }
    if (orgUnitIds.length) {
      subjectConds.push(
        and(
          eq(resourceAcl.subjectType, 'org_unit'),
          inArray(resourceAcl.subjectId, orgUnitIds),
        ) as SQL,
      );
    }

    // Node ids shared with me: explicit ACL grants...
    const aclRows = await this.db
      .selectDistinct({ id: resourceAcl.resourceId })
      .from(resourceAcl)
      .where(and(inArray(resourceAcl.resourceType, ['folder', 'file']), or(...subjectConds)));
    // ...plus still-valid links I have accepted.
    const linkRows = await this.db
      .selectDistinct({ id: fileLinkGrants.nodeId })
      .from(fileLinkGrants)
      .innerJoin(fileLinks, eq(fileLinks.id, fileLinkGrants.linkId))
      .where(
        and(
          eq(fileLinkGrants.userId, user.id),
          or(isNull(fileLinks.expiresAt), gt(fileLinks.expiresAt, new Date())),
        ),
      );

    const nodeIds = [...new Set([...aclRows, ...linkRows].map((r) => r.id))];
    if (nodeIds.length === 0) return [];

    const nodeRows = await this.db
      .select()
      .from(fsNodes)
      .where(and(inArray(fsNodes.id, nodeIds), isNull(fsNodes.deletedAt)));

    const nodes = nodeRows.filter((n) => {
      // Not my own personal node.
      if (n.space === 'personal' && n.ownerUserId === user.id) return false;
      // Not a membership org root (that is "Общие", not "shared with me").
      if (
        n.space === 'org' &&
        n.parentId === null &&
        n.ownerOrgUnitId &&
        orgUnitIds.includes(n.ownerOrgUnitId)
      ) {
        return false;
      }
      return true;
    });

    // Dedup to top-most: drop a node if any ancestor is also in the shared set.
    const sharedIds = new Set(nodes.map((n) => n.id));
    const topMost = nodes.filter((n) => {
      const ancestors = n.path.split('.').slice(0, -1);
      return !ancestors.some((a) => sharedIds.has(a));
    });

    return topMost.map((n) => this.nodes.toDto(n));
  }

  // --- helpers ---

  /**
   * Who may manage sharing on a node: superadmin, a personal owner, anyone with
   * a `manager` grant on the node or an ancestor, or — for org nodes — a holder
   * of `files.org.manage` SCOPED to the node's owning unit (docs/modules/12 §1).
   * The scope check goes through ScopeService (which honours the role
   * assignment's org-unit scope + subtree), not the flat un-scoped permission
   * list, so a manager scoped to unit A cannot manage unit B's files.
   */
  private async assertManage(node: FsNode, user: AuthUser): Promise<void> {
    if (user.isSuperadmin) return;
    if (node.space === 'personal' && node.ownerUserId === user.id) return;
    if (await this.nodes.hasAccess(node, user, 'manager')) return;
    if (node.space === 'org' && node.ownerOrgUnitId) {
      const scope = await this.scope.getAccessibleOrgUnits(user, 'files.org.manage');
      if (scope.global || scope.orgUnitIds.includes(node.ownerOrgUnitId)) return;
    }
    throw AppException.forbidden(
      'files.share.forbidden',
      'You cannot manage access for this file or folder',
    );
  }

  /** The org root's own org_unit grant (the unit's baseline access) — off-limits
   *  to both grant and revoke, or a manager could downgrade/escalate the whole
   *  unit's access to the shared space in one call. */
  private isProtectedRootGrant(node: FsNode, subjectType: string, subjectId: string): boolean {
    return (
      node.space === 'org' &&
      node.parentId === null &&
      subjectType === 'org_unit' &&
      subjectId === node.ownerOrgUnitId
    );
  }

  private async aclRowsFor(
    resourceIds: string[],
  ): Promise<
    Array<{ id: string; subjectType: string; subjectId: string; resourceId: string; level: string }>
  > {
    return this.db
      .select({
        id: resourceAcl.id,
        subjectType: resourceAcl.subjectType,
        subjectId: resourceAcl.subjectId,
        resourceId: resourceAcl.resourceId,
        level: resourceAcl.level,
      })
      .from(resourceAcl)
      .where(
        and(
          inArray(resourceAcl.resourceType, ['folder', 'file']),
          inArray(resourceAcl.resourceId, resourceIds),
        ),
      );
  }

  private async toAclEntry(
    row: { id: string; subjectType: string; subjectId: string; level: string },
    inherited: boolean,
    inheritedFrom: string | null,
  ): Promise<NodeAclEntryDto> {
    return {
      id: row.id,
      subjectType: row.subjectType as NodeAclEntryDto['subjectType'],
      subjectId: row.subjectId,
      subjectName: await this.resolveSubjectName(row.subjectType, row.subjectId),
      level: row.level as NodeAclEntryDto['level'],
      inherited,
      inheritedFrom,
    };
  }

  private async resolveSubjectName(subjectType: string, subjectId: string): Promise<string> {
    if (subjectType === 'user') {
      const [u] = await this.db
        .select({ name: users.shortName })
        .from(users)
        .where(eq(users.id, subjectId))
        .limit(1);
      return u?.name ?? '—';
    }
    if (subjectType === 'org_unit') {
      const [o] = await this.db
        .select({ name: orgUnits.name })
        .from(orgUnits)
        .where(eq(orgUnits.id, subjectId))
        .limit(1);
      return o?.name ?? '—';
    }
    const [r] = await this.db
      .select({ name: roles.name })
      .from(roles)
      .where(eq(roles.id, subjectId))
      .limit(1);
    return r?.name ?? '—';
  }

  private async assertSubjectExists(subjectType: string, subjectId: string): Promise<void> {
    const table = subjectType === 'user' ? users : subjectType === 'org_unit' ? orgUnits : roles;
    const [row] = await this.db
      .select({ id: table.id })
      .from(table)
      .where(eq(table.id, subjectId))
      .limit(1);
    if (!row) {
      throw AppException.badRequest('files.share.subject_not_found', 'Subject does not exist');
    }
  }

  private toLinkDto(row: typeof fileLinks.$inferSelect): FileLinkDto {
    return {
      id: row.id,
      nodeId: row.nodeId,
      token: row.token,
      url: `${FILE_LINK_URL_PREFIX}/${row.token}`,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
