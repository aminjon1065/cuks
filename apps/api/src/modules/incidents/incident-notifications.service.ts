import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { roles, type Database, userRoles, users } from '@cuks/db';
import type { IncidentStatus } from '@cuks/shared';
import { DB } from '../../common/db/db.module';
import { NotificationsService } from '../notifications/notifications.service';

const INCIDENT_RECIPIENT_ROLES = {
  duty: 'duty_officer',
  leadership: 'chief',
} as const;

export function incidentRecipientRoleCodes(severity: number): readonly string[] {
  return severity >= 3
    ? [INCIDENT_RECIPIENT_ROLES.duty, INCIDENT_RECIPIENT_ROLES.leadership]
    : [INCIDENT_RECIPIENT_ROLES.duty];
}

export type IncidentNotificationEvent = 'created' | 'updated' | 'status_changed';

export interface IncidentNotificationInput {
  event: IncidentNotificationEvent;
  incidentId: string;
  number: string;
  severity: number;
  dedupeKey: string;
  fromStatus?: IncidentStatus;
  toStatus?: IncidentStatus;
}

function notificationCopy(input: IncidentNotificationInput): { title: string; body: string } {
  if (input.event === 'created') {
    return {
      title: `Зарегистрирована ЧС ${input.number}`,
      body: `Уровень ЧС: ${input.severity}. Откройте карточку для оперативных данных.`,
    };
  }
  if (input.event === 'status_changed') {
    return {
      title: `Изменён статус ЧС ${input.number}`,
      body: `${input.fromStatus ?? 'unknown'} → ${input.toStatus ?? 'unknown'}`,
    };
  }
  return {
    title: `Обновлена ЧС ${input.number}`,
    body: 'В карточке появились новые оперативные данные.',
  };
}

/** Recipient matrix for incident domain events (docs/modules/10 §10). */
@Injectable()
export class IncidentNotificationsService {
  private readonly logger = new Logger(IncidentNotificationsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Best-effort compatibility entry point for callers without a durable outbox.
   * Incident mutations use {@link deliver} through the outbox dispatcher.
   */
  async notify(input: IncidentNotificationInput): Promise<void> {
    try {
      await this.deliver(input);
    } catch (err) {
      this.logger.error(
        { err, incidentId: input.incidentId, event: input.event },
        'failed to fan out incident notifications',
      );
    }
  }

  /**
   * Throwing delivery path used by the durable dispatcher. A row is marked as
   * processed only when recipient resolution and fan-out both succeed.
   */
  async deliver(input: IncidentNotificationInput): Promise<void> {
    const roleCodes = incidentRecipientRoleCodes(input.severity);
    const rows = await this.db
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
      );
    const userIds = rows.map((row) => row.id);
    const copy = notificationCopy(input);
    await this.notifications.notifyMany({
      userIds,
      type: `incidents.incident.${input.event}`,
      title: copy.title,
      body: copy.body,
      priority: input.severity >= 4 ? 'critical' : 'normal',
      emailMode: 'offline',
      entityType: 'incident',
      entityId: input.incidentId,
      payload: {
        number: input.number,
        severity: input.severity,
        ...(input.event === 'status_changed'
          ? {
              fromStatus: input.fromStatus ?? null,
              toStatus: input.toStatus ?? null,
            }
          : {}),
      },
      dedupeKey: input.dedupeKey,
    });
  }
}
