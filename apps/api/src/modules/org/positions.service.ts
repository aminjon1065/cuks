import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { type Database, orgUnits, positions, userPositions } from '@cuks/db';
import type { CreatePositionInput, PositionDto, UpdatePositionInput } from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';

/** Positions within org units (docs/05 §2). `admin.org.manage`. */
@Injectable()
export class PositionsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async listByUnit(orgUnitId: string): Promise<PositionDto[]> {
    const rows = await this.db
      .select()
      .from(positions)
      .where(and(eq(positions.orgUnitId, orgUnitId), isNull(positions.deletedAt)))
      .orderBy(positions.rank, positions.name);
    return rows.map((r) => this.toDto(r));
  }

  async create(input: CreatePositionInput, actorId: string): Promise<PositionDto> {
    await this.requireLiveUnit(input.orgUnitId);
    const [row] = await this.db
      .insert(positions)
      .values({
        orgUnitId: input.orgUnitId,
        name: input.name,
        rank: input.rank ?? 0,
        isHead: input.isHead ?? false,
        createdBy: actorId,
      })
      .returning();
    if (!row)
      throw AppException.badRequest('admin.position.create_failed', 'Could not create position');
    this.audit.log({
      action: 'admin.position.created',
      actorId,
      entityType: 'position',
      entityId: row.id,
    });
    return this.toDto(row);
  }

  async update(id: string, input: UpdatePositionInput, actorId: string): Promise<PositionDto> {
    await this.requirePosition(id);
    const [row] = await this.db
      .update(positions)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.rank !== undefined ? { rank: input.rank } : {}),
        ...(input.isHead !== undefined ? { isHead: input.isHead } : {}),
      })
      .where(eq(positions.id, id))
      .returning();
    if (!row) throw AppException.notFound('admin.position.not_found', 'Position not found');
    this.audit.log({
      action: 'admin.position.updated',
      actorId,
      entityType: 'position',
      entityId: id,
    });
    return this.toDto(row);
  }

  async remove(id: string, actorId: string): Promise<void> {
    await this.requirePosition(id);
    const [holder] = await this.db
      .select({ id: userPositions.id })
      .from(userPositions)
      .where(eq(userPositions.positionId, id))
      .limit(1);
    if (holder) {
      throw AppException.badRequest(
        'admin.position.has_holders',
        'Unassign users from this position first',
      );
    }
    await this.db.transaction(async (tx) => {
      // Clear the head reference if this position heads its unit.
      await tx
        .update(orgUnits)
        .set({ headPositionId: null })
        .where(eq(orgUnits.headPositionId, id));
      await tx.update(positions).set({ deletedAt: new Date() }).where(eq(positions.id, id));
    });
    this.audit.log({
      action: 'admin.position.deleted',
      actorId,
      entityType: 'position',
      entityId: id,
    });
  }

  private async requireLiveUnit(orgUnitId: string): Promise<void> {
    const [unit] = await this.db
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(and(eq(orgUnits.id, orgUnitId), isNull(orgUnits.deletedAt)))
      .limit(1);
    if (!unit) throw AppException.notFound('admin.org_unit.not_found', 'Org unit not found');
  }

  private async requirePosition(id: string): Promise<typeof positions.$inferSelect> {
    const [row] = await this.db
      .select()
      .from(positions)
      .where(and(eq(positions.id, id), isNull(positions.deletedAt)))
      .limit(1);
    if (!row) throw AppException.notFound('admin.position.not_found', 'Position not found');
    return row;
  }

  private toDto(row: typeof positions.$inferSelect): PositionDto {
    return {
      id: row.id,
      orgUnitId: row.orgUnitId,
      name: row.name,
      rank: row.rank,
      isHead: row.isHead,
    };
  }
}
