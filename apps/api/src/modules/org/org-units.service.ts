import { Inject, Injectable } from '@nestjs/common';
import { and, countDistinct, eq, isNull, like, sql } from 'drizzle-orm';
import { type Database, orgUnits, positions, userPositions, userRoles, users } from '@cuks/db';
import type {
  CreateOrgUnitInput,
  OrgUnitDto,
  OrgUnitTreeNode,
  UpdateOrgUnitInput,
} from '@cuks/shared';
import { uuidv7 } from 'uuidv7';
import { AuditService } from '../../common/audit/audit.service';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { OrgChannelsService } from '../chat/org-channels.service';

// Transaction-level advisory lock key that serializes concurrent moves so the
// cycle guard cannot be invalidated by a simultaneous move.
const MOVE_LOCK_KEY = 4242001;

/** Org-unit tree management (docs/05 §2, docs/16 §2). `admin.org.manage`. */
@Injectable()
export class OrgUnitsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly orgChannels: OrgChannelsService,
  ) {}

  async tree(): Promise<OrgUnitTreeNode[]> {
    const rows = await this.db
      .select()
      .from(orgUnits)
      .where(isNull(orgUnits.deletedAt))
      .orderBy(orgUnits.sort, orgUnits.name);
    const counts = await this.employeeCounts();

    const nodes = new Map<string, OrgUnitTreeNode>();
    for (const r of rows) {
      nodes.set(r.id, {
        id: r.id,
        parentId: r.parentId,
        name: r.name,
        shortName: r.shortName,
        type: r.type,
        path: r.path,
        sort: r.sort,
        headPositionId: r.headPositionId,
        employeeCount: counts.get(r.id) ?? 0,
        children: [],
      });
    }
    const roots: OrgUnitTreeNode[] = [];
    for (const node of nodes.values()) {
      const parent = node.parentId ? nodes.get(node.parentId) : undefined;
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
    return roots;
  }

  async create(input: CreateOrgUnitInput, actorId: string): Promise<OrgUnitDto> {
    const parent = input.parentId ? await this.requireUnit(input.parentId) : null;
    const id = uuidv7();
    const path = parent ? `${parent.path}.${id}` : id;
    await this.db.insert(orgUnits).values({
      id,
      parentId: input.parentId ?? null,
      name: input.name,
      shortName: input.shortName ?? null,
      type: input.type,
      sort: input.sort ?? 0,
      path,
      createdBy: actorId,
    });
    this.audit.log({
      action: 'admin.org_unit.created',
      actorId,
      entityType: 'org_unit',
      entityId: id,
    });
    // Every org unit gets its channel (docs/modules/13 §2) — best-effort.
    void this.orgChannels.ensureChannel(id);
    return this.getOne(id);
  }

  async update(id: string, input: UpdateOrgUnitInput, actorId: string): Promise<OrgUnitDto> {
    await this.requireUnit(id);
    if (input.headPositionId) {
      const [pos] = await this.db
        .select({ id: positions.id })
        .from(positions)
        .where(
          and(
            eq(positions.id, input.headPositionId),
            eq(positions.orgUnitId, id),
            isNull(positions.deletedAt),
          ),
        )
        .limit(1);
      if (!pos) {
        throw AppException.badRequest(
          'admin.org_unit.head_not_in_unit',
          'Head position must be a live position in the unit',
        );
      }
    }
    await this.db
      .update(orgUnits)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.shortName !== undefined ? { shortName: input.shortName } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.sort !== undefined ? { sort: input.sort } : {}),
        ...(input.headPositionId !== undefined ? { headPositionId: input.headPositionId } : {}),
      })
      .where(eq(orgUnits.id, id));
    this.audit.log({
      action: 'admin.org_unit.updated',
      actorId,
      entityType: 'org_unit',
      entityId: id,
    });
    return this.getOne(id);
  }

  async move(id: string, newParentId: string | null, actorId: string): Promise<OrgUnitDto> {
    if (newParentId === id) {
      throw AppException.badRequest(
        'admin.org_unit.move_into_self',
        'Cannot move a unit into itself',
      );
    }
    await this.db.transaction(async (tx) => {
      // Serialize moves so a concurrent move can't invalidate the cycle guard.
      await tx.execute(sql`select pg_advisory_xact_lock(${MOVE_LOCK_KEY})`);
      const unit = await this.requireUnit(id, tx);
      const parent = newParentId ? await this.requireUnit(newParentId, tx) : null;
      // Prevent moving a unit into its own subtree (cycle).
      if (parent && (parent.path === unit.path || parent.path.startsWith(`${unit.path}.`))) {
        throw AppException.badRequest(
          'admin.org_unit.move_into_descendant',
          'Cannot move a unit into its own subtree',
        );
      }
      const oldPath = unit.path;
      const newPath = parent ? `${parent.path}.${id}` : id;
      if (oldPath === newPath) return;

      // Re-root descendants: swap the old path prefix for the new one (computed in
      // JS to keep it simple and robust; org trees are small).
      const descendants = await tx
        .select({ id: orgUnits.id, path: orgUnits.path })
        .from(orgUnits)
        .where(like(orgUnits.path, `${oldPath}.%`));
      for (const d of descendants) {
        await tx
          .update(orgUnits)
          .set({ path: `${newPath}${d.path.slice(oldPath.length)}` })
          .where(eq(orgUnits.id, d.id));
      }
      await tx
        .update(orgUnits)
        .set({ parentId: newParentId, path: newPath })
        .where(eq(orgUnits.id, id));
    });
    this.audit.log({
      action: 'admin.org_unit.moved',
      actorId,
      entityType: 'org_unit',
      entityId: id,
      meta: { newParentId },
    });
    return this.getOne(id);
  }

  async remove(id: string, actorId: string): Promise<void> {
    await this.requireUnit(id);
    const [child] = await this.db
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(and(eq(orgUnits.parentId, id), isNull(orgUnits.deletedAt)))
      .limit(1);
    if (child)
      throw AppException.badRequest(
        'admin.org_unit.has_children',
        'Move or delete child units first',
      );
    const [pos] = await this.db
      .select({ id: positions.id })
      .from(positions)
      .where(and(eq(positions.orgUnitId, id), isNull(positions.deletedAt)))
      .limit(1);
    if (pos)
      throw AppException.badRequest(
        'admin.org_unit.has_positions',
        'Delete the unit positions first',
      );
    const [scoped] = await this.db
      .select({ id: userRoles.id })
      .from(userRoles)
      .where(eq(userRoles.orgUnitId, id))
      .limit(1);
    if (scoped)
      throw AppException.badRequest(
        'admin.org_unit.has_role_scopes',
        'Reassign role scopes on this unit first',
      );

    await this.db.update(orgUnits).set({ deletedAt: new Date() }).where(eq(orgUnits.id, id));
    this.audit.log({
      action: 'admin.org_unit.deleted',
      actorId,
      entityType: 'org_unit',
      entityId: id,
    });
  }

  private async employeeCounts(): Promise<Map<string, number>> {
    // Distinct active people per unit (a user with two positions in a unit counts
    // once; blocked/deleted users are excluded).
    const rows = await this.db
      .select({ orgUnitId: positions.orgUnitId, n: countDistinct(userPositions.userId) })
      .from(positions)
      .innerJoin(userPositions, eq(userPositions.positionId, positions.id))
      .innerJoin(
        users,
        and(
          eq(users.id, userPositions.userId),
          isNull(users.deletedAt),
          eq(users.status, 'active'),
        ),
      )
      .where(isNull(positions.deletedAt))
      .groupBy(positions.orgUnitId);
    return new Map(rows.map((r) => [r.orgUnitId, Number(r.n)]));
  }

  private async requireUnit(
    id: string,
    db: Database = this.db,
  ): Promise<typeof orgUnits.$inferSelect> {
    const [unit] = await db
      .select()
      .from(orgUnits)
      .where(and(eq(orgUnits.id, id), isNull(orgUnits.deletedAt)))
      .limit(1);
    if (!unit) throw AppException.notFound('admin.org_unit.not_found', 'Org unit not found');
    return unit;
  }

  private async getOne(id: string): Promise<OrgUnitDto> {
    const unit = await this.requireUnit(id);
    const counts = await this.employeeCounts();
    return {
      id: unit.id,
      parentId: unit.parentId,
      name: unit.name,
      shortName: unit.shortName,
      type: unit.type,
      path: unit.path,
      sort: unit.sort,
      headPositionId: unit.headPositionId,
      employeeCount: counts.get(unit.id) ?? 0,
    };
  }
}
