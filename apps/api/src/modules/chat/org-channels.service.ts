import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  chatChannels,
  chatMembers,
  orgUnits,
  positions,
  userPositions,
  users,
  type Database,
} from '@cuks/db';
import { DB } from '../../common/db/db.module';

/**
 * Auto-provisioned org-unit channels (docs/modules/13 §2, task 5.1). Every org unit has one `org`
 * channel whose members are the unit's staff; a personnel change (assign / unassign a position)
 * re-syncs the affected unit's channel. Idempotent — safe to call repeatedly.
 */
@Injectable()
export class OrgChannelsService {
  private readonly logger = new Logger(OrgChannelsService.name);

  constructor(@Inject(DB) private readonly db: Database) {}

  /** Ensure the org unit has its `org` channel; returns the channel id (or null if the unit is gone). */
  async ensureChannel(orgUnitId: string): Promise<string | null> {
    const [unit] = await this.db
      .select({ id: orgUnits.id, name: orgUnits.name })
      .from(orgUnits)
      .where(and(eq(orgUnits.id, orgUnitId), isNull(orgUnits.deletedAt)))
      .limit(1);
    if (!unit) return null;

    const [existing] = await this.db
      .select({ id: chatChannels.id })
      .from(chatChannels)
      .where(
        and(
          eq(chatChannels.orgUnitId, orgUnitId),
          eq(chatChannels.kind, 'org'),
          isNull(chatChannels.deletedAt),
        ),
      )
      .limit(1);
    if (existing) return existing.id;

    const [created] = await this.db
      .insert(chatChannels)
      .values({ kind: 'org', name: unit.name, orgUnitId })
      // The partial unique index (one live org channel per unit) makes a concurrent create a no-op.
      .onConflictDoNothing()
      .returning({ id: chatChannels.id });
    if (created) return created.id;

    // A racing insert won the unique index — read the winner back.
    const [row] = await this.db
      .select({ id: chatChannels.id })
      .from(chatChannels)
      .where(
        and(
          eq(chatChannels.orgUnitId, orgUnitId),
          eq(chatChannels.kind, 'org'),
          isNull(chatChannels.deletedAt),
        ),
      )
      .limit(1);
    return row?.id ?? null;
  }

  /** Reconcile the org channel's membership to the unit's current staff. */
  async syncOrgUnit(orgUnitId: string): Promise<void> {
    try {
      const channelId = await this.ensureChannel(orgUnitId);
      if (!channelId) return;

      const staff = await this.db
        .selectDistinct({ userId: userPositions.userId })
        .from(userPositions)
        .innerJoin(
          positions,
          and(eq(positions.id, userPositions.positionId), isNull(positions.deletedAt)),
        )
        .innerJoin(users, and(eq(users.id, userPositions.userId), isNull(users.deletedAt)))
        .where(eq(positions.orgUnitId, orgUnitId));
      const target = new Set(staff.map((s) => s.userId));

      const current = await this.db
        .select({ userId: chatMembers.userId })
        .from(chatMembers)
        .where(eq(chatMembers.channelId, channelId));
      const currentSet = new Set(current.map((m) => m.userId));

      const toAdd = [...target].filter((id) => !currentSet.has(id));
      const toRemove = [...currentSet].filter((id) => !target.has(id));

      if (toAdd.length) {
        await this.db
          .insert(chatMembers)
          .values(toAdd.map((userId) => ({ channelId, userId, memberRole: 'member' as const })))
          .onConflictDoNothing();
      }
      if (toRemove.length) {
        await this.db
          .delete(chatMembers)
          .where(and(eq(chatMembers.channelId, channelId), inArray(chatMembers.userId, toRemove)));
      }
    } catch (error) {
      // Membership sync is best-effort — a personnel change must not fail because of it.
      this.logger.error({ error, orgUnitId }, 'org channel sync failed');
    }
  }

  /** Provision + sync every org unit's channel (seed / maintenance). */
  async syncAll(): Promise<number> {
    const units = await this.db
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(isNull(orgUnits.deletedAt));
    for (const unit of units) await this.syncOrgUnit(unit.id);
    return units.length;
  }
}
