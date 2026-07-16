import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  chatChannels,
  chatMembers,
  entityLinks,
  incidents,
  roles,
  userRoles,
  users,
  type Database,
} from '@cuks/db';
import { wsRooms, type ChannelDto } from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { RealtimeService } from '../events/realtime.service';
import { incidentRecipientRoleCodes } from '../incidents/incident-notifications.service';
import { ChannelsService } from './channels.service';

/** Advisory-lock namespace — serializes concurrent «create incident channel» on the same incident. */
const INCIDENT_CHANNEL_LOCK_NS = 4242003;

/**
 * The chat channel bound to an incident (docs/modules/13 §2 «Канал ЧС»): named `чс-{номер}`, kind
 * `incident`, linked to the incident via entity_links, seeded with the notification-matrix recipients
 * plus the creator. Idempotent — one channel per incident, guarded by an advisory lock.
 */
@Injectable()
export class IncidentChannelsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly channels: ChannelsService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  async openForIncident(incidentId: string, actor: AuthUser): Promise<ChannelDto> {
    const [incident] = await this.db
      .select({ id: incidents.id, number: incidents.number, severity: incidents.severity })
      .from(incidents)
      .where(and(eq(incidents.id, incidentId), isNull(incidents.deletedAt)))
      .limit(1);
    if (!incident) throw AppException.notFound('incident.not_found', 'Incident not found');

    const channelId = await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(${INCIDENT_CHANNEL_LOCK_NS}, hashtext(${incidentId}))`,
      );

      // Reuse the existing channel if the incident already has one.
      const [existing] = await tx
        .select({ id: chatChannels.id })
        .from(entityLinks)
        .innerJoin(
          chatChannels,
          and(eq(chatChannels.id, entityLinks.targetId), isNull(chatChannels.deletedAt)),
        )
        .where(
          and(
            eq(entityLinks.sourceType, 'incident'),
            eq(entityLinks.sourceId, incidentId),
            eq(entityLinks.targetType, 'chat_channel'),
          ),
        )
        .limit(1);
      if (existing) {
        // Ensure the caller is a member so they can open it (e.g. a new responder).
        await tx
          .insert(chatMembers)
          .values({ channelId: existing.id, userId: actor.id, memberRole: 'member' })
          .onConflictDoNothing({ target: [chatMembers.channelId, chatMembers.userId] });
        return existing.id;
      }

      const [channel] = await tx
        .insert(chatChannels)
        .values({ kind: 'incident', name: `чс-${incident.number}`, createdBy: actor.id })
        .returning({ id: chatChannels.id });
      const memberIds = await this.recipientIds(tx, incident.severity, actor.id);
      await tx.insert(chatMembers).values(
        memberIds.map((userId) => ({
          channelId: channel!.id,
          userId,
          memberRole: (userId === actor.id ? 'owner' : 'member') as 'owner' | 'member',
        })),
      );
      await tx.insert(entityLinks).values({
        sourceType: 'incident',
        sourceId: incidentId,
        targetType: 'chat_channel',
        targetId: channel!.id,
        createdBy: actor.id,
      });
      return channel!.id;
    });

    this.audit.log({
      action: 'chat.incident_channel.opened',
      actorId: actor.id,
      entityType: 'chat_channel',
      entityId: channelId,
      meta: { incidentId, number: incident.number },
    });
    this.realtime.emitToRoom(wsRooms.channel(channelId), 'chat.channel.updated', {
      channelId,
      actorId: actor.id,
    });
    return this.channels.get(channelId, actor);
  }

  /** The notification-matrix recipients for the incident's severity, plus the creator (deduped). */
  private async recipientIds(tx: Database, severity: number, actorId: string): Promise<string[]> {
    const roleCodes = incidentRecipientRoleCodes(severity);
    const rows = roleCodes.length
      ? await tx
          .selectDistinct({ id: users.id })
          .from(users)
          .innerJoin(userRoles, eq(userRoles.userId, users.id))
          .innerJoin(roles, eq(roles.id, userRoles.roleId))
          .where(
            and(
              inArray(roles.code, [...roleCodes]),
              eq(users.status, 'active'),
              isNull(users.deletedAt),
              isNull(roles.deletedAt),
            ),
          )
      : [];
    return [...new Set([actorId, ...rows.map((r) => r.id)])];
  }
}
