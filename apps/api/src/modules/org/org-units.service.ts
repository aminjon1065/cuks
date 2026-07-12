import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, isNull, like } from 'drizzle-orm';
import { type Database, orgUnits, positions, userPositions } from '@cuks/db';
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

/** Org-unit tree management (docs/05 §2, docs/16 §2). `admin.org.manage`. */
@Injectable()
export class OrgUnitsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
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
    return this.getOne(id);
  }

  async update(id: string, input: UpdateOrgUnitInput, actorId: string): Promise<OrgUnitDto> {
    await this.requireUnit(id);
    if (input.headPositionId) {
      const [pos] = await this.db
        .select({ id: positions.id })
        .from(positions)
        .where(and(eq(positions.id, input.headPositionId), eq(positions.orgUnitId, id)))
        .limit(1);
      if (!pos) {
        throw AppException.badRequest(
          'admin.org_unit.head_not_in_unit',
          'Head position must belong to the unit',
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
    const unit = await this.requireUnit(id);
    if (newParentId === id) {
      throw AppException.badRequest(
        'admin.org_unit.move_into_self',
        'Cannot move a unit into itself',
      );
    }
    const parent = newParentId ? await this.requireUnit(newParentId) : null;
    // Prevent moving a unit into its own subtree (cycle).
    if (parent && (parent.path === unit.path || parent.path.startsWith(`${unit.path}.`))) {
      throw AppException.badRequest(
        'admin.org_unit.move_into_descendant',
        'Cannot move a unit into its own subtree',
      );
    }
    const oldPath = unit.path;
    const newPath = parent ? `${parent.path}.${id}` : id;
    if (oldPath === newPath) return this.getOne(id);

    await this.db.transaction(async (tx) => {
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

    await this.db.update(orgUnits).set({ deletedAt: new Date() }).where(eq(orgUnits.id, id));
    this.audit.log({
      action: 'admin.org_unit.deleted',
      actorId,
      entityType: 'org_unit',
      entityId: id,
    });
  }

  private async employeeCounts(): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ orgUnitId: positions.orgUnitId, n: count(userPositions.id) })
      .from(positions)
      .innerJoin(userPositions, eq(userPositions.positionId, positions.id))
      .where(isNull(positions.deletedAt))
      .groupBy(positions.orgUnitId);
    return new Map(rows.map((r) => [r.orgUnitId, Number(r.n)]));
  }

  private async requireUnit(id: string): Promise<typeof orgUnits.$inferSelect> {
    const [unit] = await this.db
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
