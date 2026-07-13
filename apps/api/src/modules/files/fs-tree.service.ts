import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNotNull, isNull, like, or, sql } from 'drizzle-orm';
import { fsNodes, type Database } from '@cuks/db';
import type {
  CreateFolderInput,
  FsNodeDto,
  PatchNodeInput,
  TreeQuery,
  TreeResponse,
} from '@cuks/shared';
import { uuidv7 } from 'uuidv7';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { FsNodesService, MOVE_LOCK_KEY, type FsNode } from './fs-nodes.service';

/** Tree navigation, folder CRUD, move, and trash/restore (docs/modules/12 §3, §6). */
@Injectable()
export class FsTreeService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly nodes: FsNodesService,
    private readonly audit: AuditService,
  ) {}

  async tree(query: TreeQuery, user: AuthUser): Promise<TreeResponse> {
    let parent: FsNode | null = null;
    if (query.parentId) {
      parent = await this.nodes.requireNode(query.parentId);
      await this.nodes.assertAccess(parent, user, 'viewer');
    } else if (query.space === 'org') {
      if (!query.orgUnitId) {
        throw AppException.badRequest(
          'files.tree.org_unit_required',
          'orgUnitId is required to list an org space root',
        );
      }
      parent = await this.nodes.ensureOrgRoot(query.orgUnitId, user);
      await this.nodes.assertAccess(parent, user, 'viewer');
    } else if (query.space === 'system') {
      throw AppException.badRequest(
        'files.tree.system_not_browsable',
        'System-space attachments are not browsable directly',
      );
    }
    // personal + no parentId: list root-level personal nodes owned by the caller.

    const where = parent
      ? and(eq(fsNodes.parentId, parent.id), isNull(fsNodes.deletedAt))
      : and(
          isNull(fsNodes.parentId),
          eq(fsNodes.space, 'personal'),
          eq(fsNodes.ownerUserId, user.id),
          isNull(fsNodes.deletedAt),
        );

    const rows = await this.db.select().from(fsNodes).where(where);
    const items = rows
      .map((r) => this.nodes.toDto(r))
      .sort((a, b) =>
        a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1,
      );
    const breadcrumbs = parent ? await this.nodes.breadcrumbsFor(parent.path) : [];
    return { items, breadcrumbs, rootId: parent?.id ?? null };
  }

  async getOne(
    id: string,
    user: AuthUser,
  ): Promise<{ node: FsNodeDto; breadcrumbs: TreeResponse['breadcrumbs'] }> {
    const node = await this.nodes.requireNode(id);
    await this.nodes.assertAccess(node, user, 'viewer');
    return {
      node: this.nodes.toDto(node),
      breadcrumbs: await this.nodes.breadcrumbsFor(node.path),
    };
  }

  async createFolder(input: CreateFolderInput, user: AuthUser): Promise<FsNodeDto> {
    const { parent, ownerUserId, ownerOrgUnitId } = await this.nodes.resolveTarget(
      input.space,
      input.parentId ?? null,
      input.orgUnitId,
      user,
    );
    if (parent) await this.nodes.assertAccess(parent, user, 'editor');
    await this.nodes.assertNoSibling(
      parent?.id ?? null,
      input.space,
      ownerUserId,
      ownerOrgUnitId,
      input.name,
    );
    const id = uuidv7();
    const path = parent ? `${parent.path}.${id}` : id;
    const [row] = await this.db
      .insert(fsNodes)
      .values({
        id,
        parentId: parent?.id ?? null,
        kind: 'folder',
        name: input.name,
        space: input.space,
        ownerUserId,
        ownerOrgUnitId,
        path,
        createdBy: user.id,
      })
      .returning();
    this.audit.log({
      action: 'files.folder.created',
      actorId: user.id,
      entityType: 'folder',
      entityId: id,
    });
    return this.nodes.toDto(row!);
  }

  /** Rename and/or replace tags in place. Handles a parent change (move)
   *  separately — see `move()` — since that needs the advisory lock. */
  async patch(id: string, input: PatchNodeInput, user: AuthUser): Promise<FsNodeDto> {
    const node = await this.nodes.requireNode(id);
    await this.nodes.assertAccess(node, user, 'editor');

    if (input.parentId !== undefined && input.parentId !== node.parentId) {
      return this.move(node, input, user);
    }

    if (input.name !== undefined && input.name !== node.name) {
      await this.nodes.assertNoSibling(
        node.parentId,
        node.space,
        node.ownerUserId,
        node.ownerOrgUnitId,
        input.name,
        node.id,
      );
    }
    const [updated] = await this.db
      .update(fsNodes)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
      })
      .where(eq(fsNodes.id, id))
      .returning();
    this.audit.log({
      action: 'files.node.updated',
      actorId: user.id,
      entityType: node.kind,
      entityId: id,
    });
    return this.nodes.toDto(updated!);
  }

  private async move(node: FsNode, input: PatchNodeInput, user: AuthUser): Promise<FsNodeDto> {
    const newParentId = input.parentId ?? null;
    if (newParentId === node.id) {
      throw AppException.badRequest('files.node.move_into_self', 'Cannot move a node into itself');
    }

    let result!: FsNode;
    await this.db.transaction(async (tx) => {
      // Serialize moves so a concurrent move can't invalidate the cycle guard.
      await tx.execute(sql`select pg_advisory_xact_lock(${MOVE_LOCK_KEY})`);
      const fresh = await this.nodes.requireNode(node.id, tx);
      let newParent: FsNode | null = null;
      if (newParentId) {
        newParent = await this.nodes.requireNode(newParentId, tx);
        if (newParent.path === fresh.path || newParent.path.startsWith(`${fresh.path}.`)) {
          throw AppException.badRequest(
            'files.node.move_into_descendant',
            'Cannot move a node into its own subtree',
          );
        }
        if (newParent.space !== fresh.space) {
          throw AppException.badRequest('files.node.space_mismatch', 'Cannot move across spaces');
        }
        if (fresh.space === 'org' && newParent.ownerOrgUnitId !== fresh.ownerOrgUnitId) {
          // Moving between two org units' trees would leave ownerOrgUnitId (used for
          // quota accounting) pointing at the wrong org — not supported in 1.2.
          throw AppException.badRequest(
            'files.node.cross_org_move_forbidden',
            'Cannot move a node between different org units',
          );
        }
        await this.nodes.assertAccess(newParent, user, 'editor');
      } else if (fresh.space !== 'personal') {
        throw AppException.badRequest(
          'files.node.root_required',
          'Only personal-space nodes can become a root',
        );
      }

      const newName = input.name ?? fresh.name;
      await this.nodes.assertNoSibling(
        newParent?.id ?? null,
        fresh.space,
        fresh.ownerUserId,
        fresh.ownerOrgUnitId,
        newName,
        fresh.id,
      );

      const oldPath = fresh.path;
      const newPath = newParent ? `${newParent.path}.${fresh.id}` : fresh.id;

      if (fresh.kind === 'folder' && oldPath !== newPath) {
        // Rewrites descendant paths one row at a time. MOVE_LOCK_KEY is held for the
        // duration, so a very large subtree move serializes every other move in the
        // system for a while — a known scalability limitation (docs/plan/STATUS.md),
        // not addressed here; org trees are expected to stay small in 1.2's scope.
        const descendants = await tx
          .select({ id: fsNodes.id, path: fsNodes.path })
          .from(fsNodes)
          .where(like(fsNodes.path, `${oldPath}.%`));
        for (const d of descendants) {
          await tx
            .update(fsNodes)
            .set({ path: `${newPath}${d.path.slice(oldPath.length)}` })
            .where(eq(fsNodes.id, d.id));
        }
      }

      const [updated] = await tx
        .update(fsNodes)
        .set({
          parentId: newParentId,
          path: newPath,
          name: newName,
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
        })
        .where(eq(fsNodes.id, fresh.id))
        .returning();
      result = updated!;
    });
    this.audit.log({
      action: 'files.node.moved',
      actorId: user.id,
      entityType: result.kind,
      entityId: result.id,
      meta: { newParentId },
    });
    return this.nodes.toDto(result);
  }

  /** Soft-delete; cascades to the whole subtree for a folder (a folder and its
   *  contents are one unit in the trash — restored/purged together). An org unit's
   *  root folder can't be deleted this way: every member holds 'editor' on it via
   *  the auto-grant in ensureOrgRoot, which would otherwise let any ordinary member
   *  trash the entire shared space. */
  async remove(id: string, user: AuthUser): Promise<void> {
    const node = await this.nodes.requireNode(id);
    if (node.space === 'org' && node.parentId === null) {
      throw AppException.badRequest(
        'files.node.root_not_deletable',
        "An org unit's root folder cannot be deleted",
      );
    }
    await this.nodes.assertAccess(node, user, 'editor');
    const now = new Date();
    const where =
      node.kind === 'folder'
        ? and(
            or(eq(fsNodes.id, id), like(fsNodes.path, `${node.path}.%`)),
            isNull(fsNodes.deletedAt),
          )
        : eq(fsNodes.id, id);
    await this.db.update(fsNodes).set({ deletedAt: now }).where(where);
    this.audit.log({
      action: 'files.node.trashed',
      actorId: user.id,
      entityType: node.kind,
      entityId: id,
    });
  }

  async restore(id: string, user: AuthUser): Promise<FsNodeDto> {
    const [node] = await this.db.select().from(fsNodes).where(eq(fsNodes.id, id)).limit(1);
    if (!node) throw AppException.notFound('files.node.not_found', 'File or folder not found');
    if (!node.deletedAt) throw AppException.badRequest('files.node.not_trashed', 'Not in trash');
    await this.nodes.assertAccess(node, user, 'editor');
    if (node.parentId) {
      const [parent] = await this.db
        .select({ deletedAt: fsNodes.deletedAt })
        .from(fsNodes)
        .where(eq(fsNodes.id, node.parentId))
        .limit(1);
      if (parent?.deletedAt) {
        throw AppException.badRequest(
          'files.node.parent_trashed',
          'Restore the parent folder first',
        );
      }
    }
    // Only clear the same cascade group (deleted at the same instant as this node),
    // so a descendant trashed independently and later isn't pulled back too.
    const deletedAt = node.deletedAt;
    const where =
      node.kind === 'folder'
        ? and(
            or(eq(fsNodes.id, id), like(fsNodes.path, `${node.path}.%`)),
            eq(fsNodes.deletedAt, deletedAt),
          )
        : eq(fsNodes.id, id);
    await this.db.update(fsNodes).set({ deletedAt: null }).where(where);
    this.audit.log({
      action: 'files.node.restored',
      actorId: user.id,
      entityType: node.kind,
      entityId: id,
    });
    return this.nodes.toDto(await this.nodes.requireNode(id));
  }

  /** Top-level trashed items only (a cascade-deleted descendant's own parent is
   *  also trashed, so it's hidden — restoring the top item brings back everything). */
  async listTrash(
    space: 'personal' | 'org' | 'system',
    orgUnitId: string | undefined,
    user: AuthUser,
  ): Promise<FsNodeDto[]> {
    const conds = [isNotNull(fsNodes.deletedAt), eq(fsNodes.space, space)];
    if (space === 'personal') {
      conds.push(eq(fsNodes.ownerUserId, user.id));
    } else if (space === 'org') {
      if (!orgUnitId) {
        throw AppException.badRequest('files.trash.org_unit_required', 'orgUnitId is required');
      }
      const root = await this.nodes.ensureOrgRoot(orgUnitId, user);
      await this.nodes.assertAccess(root, user, 'viewer');
      conds.push(eq(fsNodes.ownerOrgUnitId, orgUnitId));
    } else {
      throw AppException.badRequest(
        'files.trash.system_not_supported',
        'Not applicable to system space',
      );
    }
    const rows = await this.db
      .select()
      .from(fsNodes)
      .where(and(...conds));
    const trashedIds = new Set(rows.map((r) => r.id));
    return rows
      .filter((r) => !r.parentId || !trashedIds.has(r.parentId))
      .map((r) => this.nodes.toDto(r));
  }
}
