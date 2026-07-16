import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { type Database, orgUnits, positions, userPositions, users } from '@cuks/db';
import type { AssignPositionInput, UserPositionDto } from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { OrgChannelsService } from '../chat/org-channels.service';

/** True for a Postgres unique-violation error (SQLSTATE 23505). */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}

/** Assigning users to positions; exactly one primary per user (docs/05 §2). */
@Injectable()
export class UserPositionsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly orgChannels: OrgChannelsService,
  ) {}

  async listByUser(userId: string): Promise<UserPositionDto[]> {
    return this.db
      .select({
        id: userPositions.id,
        userId: userPositions.userId,
        positionId: userPositions.positionId,
        positionName: positions.name,
        orgUnitId: positions.orgUnitId,
        orgUnitName: orgUnits.name,
        isPrimary: userPositions.isPrimary,
      })
      .from(userPositions)
      .innerJoin(positions, eq(positions.id, userPositions.positionId))
      .innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId))
      .where(eq(userPositions.userId, userId));
  }

  async assign(input: AssignPositionInput, actorId: string): Promise<UserPositionDto> {
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
      .limit(1);
    if (!user) throw AppException.notFound('admin.user.not_found', 'User not found');

    const [position] = await this.db
      .select({ id: positions.id, orgUnitId: positions.orgUnitId })
      .from(positions)
      .where(and(eq(positions.id, input.positionId), isNull(positions.deletedAt)))
      .limit(1);
    if (!position) throw AppException.notFound('admin.position.not_found', 'Position not found');

    const [dup] = await this.db
      .select({ id: userPositions.id })
      .from(userPositions)
      .where(
        and(eq(userPositions.userId, input.userId), eq(userPositions.positionId, input.positionId)),
      )
      .limit(1);
    if (dup)
      throw AppException.badRequest(
        'admin.user_position.duplicate',
        'Already assigned to this position',
      );

    let result: { id: string; makePrimary: boolean };
    try {
      result = await this.db.transaction(async (tx) => {
        const existing = await tx
          .select({ id: userPositions.id })
          .from(userPositions)
          .where(eq(userPositions.userId, input.userId));
        const makePrimary = input.isPrimary || existing.length === 0;
        if (makePrimary) {
          await tx
            .update(userPositions)
            .set({ isPrimary: false })
            .where(eq(userPositions.userId, input.userId));
        }
        const [row] = await tx
          .insert(userPositions)
          .values({ userId: input.userId, positionId: input.positionId, isPrimary: makePrimary })
          .returning({ id: userPositions.id });
        if (!row)
          throw AppException.badRequest('admin.user_position.create_failed', 'Could not assign');
        return { id: row.id, makePrimary };
      });
    } catch (err) {
      // A concurrent assign racing the pre-check hits the DB unique index.
      if (isUniqueViolation(err)) {
        throw AppException.badRequest(
          'admin.user_position.duplicate',
          'Already assigned to this position',
        );
      }
      throw err;
    }
    this.audit.log({
      action: 'admin.user_position.assigned',
      actorId,
      entityType: 'user',
      entityId: input.userId,
      meta: { positionId: input.positionId, isPrimary: result.makePrimary },
    });
    // The new hire joins their unit's channel (docs/modules/13 §2) — best-effort.
    void this.orgChannels.syncOrgUnit(position.orgUnitId);
    return this.getOne(result.id);
  }

  async setPrimary(id: string, actorId: string): Promise<UserPositionDto> {
    const [row] = await this.db
      .select({ userId: userPositions.userId })
      .from(userPositions)
      .where(eq(userPositions.id, id))
      .limit(1);
    if (!row) throw AppException.notFound('admin.user_position.not_found', 'Assignment not found');
    await this.db.transaction(async (tx) => {
      await tx
        .update(userPositions)
        .set({ isPrimary: false })
        .where(and(eq(userPositions.userId, row.userId), ne(userPositions.id, id)));
      await tx.update(userPositions).set({ isPrimary: true }).where(eq(userPositions.id, id));
    });
    this.audit.log({
      action: 'admin.user_position.primary_set',
      actorId,
      entityType: 'user',
      entityId: row.userId,
      meta: { userPositionId: id },
    });
    return this.getOne(id);
  }

  async unassign(id: string, actorId: string): Promise<void> {
    const [row] = await this.db
      .select({
        userId: userPositions.userId,
        isPrimary: userPositions.isPrimary,
        orgUnitId: positions.orgUnitId,
      })
      .from(userPositions)
      .innerJoin(positions, eq(positions.id, userPositions.positionId))
      .where(eq(userPositions.id, id))
      .limit(1);
    if (!row) throw AppException.notFound('admin.user_position.not_found', 'Assignment not found');

    await this.db.transaction(async (tx) => {
      await tx.delete(userPositions).where(eq(userPositions.id, id));
      if (row.isPrimary) {
        // Promote another position to primary so the user keeps exactly one.
        const [next] = await tx
          .select({ id: userPositions.id })
          .from(userPositions)
          .where(eq(userPositions.userId, row.userId))
          .orderBy(userPositions.createdAt)
          .limit(1);
        if (next)
          await tx
            .update(userPositions)
            .set({ isPrimary: true })
            .where(eq(userPositions.id, next.id));
      }
    });
    this.audit.log({
      action: 'admin.user_position.unassigned',
      actorId,
      entityType: 'user',
      entityId: row.userId,
    });
    // Leaving the last position in a unit drops the user from that unit's channel — best-effort.
    void this.orgChannels.syncOrgUnit(row.orgUnitId);
  }

  private async getOne(id: string): Promise<UserPositionDto> {
    const [dto] = await this.db
      .select({
        id: userPositions.id,
        userId: userPositions.userId,
        positionId: userPositions.positionId,
        positionName: positions.name,
        orgUnitId: positions.orgUnitId,
        orgUnitName: orgUnits.name,
        isPrimary: userPositions.isPrimary,
      })
      .from(userPositions)
      .innerJoin(positions, eq(positions.id, userPositions.positionId))
      .innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId))
      .where(eq(userPositions.id, id))
      .limit(1);
    if (!dto) throw AppException.notFound('admin.user_position.not_found', 'Assignment not found');
    return dto;
  }
}
