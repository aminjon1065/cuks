import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, like } from 'drizzle-orm';
import { type Database, notificationPrefs, notifications, users } from '@cuks/db';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_GROUPS,
  groupOfType,
  isGroupCritical,
  type ListNotificationsQuery,
  type NotificationChannel,
  type NotificationDto,
  type NotificationGroup,
  type NotificationPrefDto,
  type NotificationPrefsUpdateInput,
  type PaginatedResult,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import { DB } from '../../common/db/db.module';
import { AppException } from '../../common/exceptions/app.exception';
import { MailService } from '../../common/mail/mail.service';
import { RealtimeService } from '../events/realtime.service';

/** Channels default to on; a stored pref row overrides. */
const DEFAULT_ENABLED = true;

type NotificationRow = typeof notifications.$inferSelect;

export interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  entityType?: string | null;
  entityId?: string | null;
  /** Email body override; falls back to `body`. */
  emailText?: string;
}

/**
 * Notifications core (docs/07 §notifications, docs/16 §B). `notify()` is the single
 * entry point every module calls: it honours the user's channel preferences (in-app
 * of a critical group can't be turned off), writes the in-app row + pushes it over
 * the socket, and sends email out-of-band. Reads back the feed, unread count and the
 * preferences matrix.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly realtime: RealtimeService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  async notify(input: NotifyInput): Promise<void> {
    const group = groupOfType(input.type);
    const prefs = await this.prefRows(input.userId);

    if (this.channelOn(group, 'inapp', prefs)) {
      const [row] = await this.db
        .insert(notifications)
        .values({
          userId: input.userId,
          type: input.type,
          title: input.title,
          body: input.body,
          entityType: input.entityType ?? null,
          entityId: input.entityId ?? null,
        })
        .returning();
      if (row) {
        this.realtime.emitToUser(input.userId, 'notify.new', {
          id: row.id,
          type: row.type,
          createdAt: row.createdAt.toISOString(),
        });
      }
    }

    if (this.channelOn(group, 'email', prefs)) {
      const [user] = await this.db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (user?.email) {
        void this.mail.send({
          to: user.email,
          subject: input.title,
          text: input.emailText ?? input.body,
        });
      }
    }

    this.audit.log({
      action: 'notifications.notify',
      actorId: input.userId,
      entityType: 'notification',
      meta: { type: input.type, group },
    });
  }

  async list(
    userId: string,
    query: ListNotificationsQuery,
  ): Promise<PaginatedResult<NotificationDto>> {
    const filters = [eq(notifications.userId, userId)];
    if (query.unread) filters.push(eq(notifications.isRead, false));
    if (query.group) filters.push(like(notifications.type, `${query.group}.%`));
    const where = and(...filters);

    const [totalRow] = await this.db.select({ total: count() }).from(notifications).where(where);

    const rows = await this.db
      .select()
      .from(notifications)
      .where(where)
      .orderBy(desc(notifications.createdAt))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);

    return {
      items: rows.map((r) => this.toDto(r)),
      total: totalRow?.total ?? 0,
      page: query.page,
      limit: query.limit,
    };
  }

  async unreadCount(userId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
    return row?.total ?? 0;
  }

  async markRead(userId: string, id: string): Promise<void> {
    const updated = await this.db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.userId, userId),
          eq(notifications.isRead, false),
        ),
      )
      .returning({ id: notifications.id });
    if (updated.length === 0) {
      // Either it doesn't exist / isn't ours, or it was already read — verify which.
      const [own] = await this.db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
        .limit(1);
      if (!own) throw AppException.notFound('notifications.not_found', 'Notification not found');
    }
  }

  async markAllRead(userId: string): Promise<void> {
    await this.db
      .update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(and(eq(notifications.userId, userId), eq(notifications.isRead, false)));
  }

  async getPrefs(userId: string): Promise<NotificationPrefDto[]> {
    const prefs = await this.prefRows(userId);
    const out: NotificationPrefDto[] = [];
    for (const group of NOTIFICATION_GROUPS) {
      for (const channel of NOTIFICATION_CHANNELS) {
        out.push({
          typeGroup: group,
          channel,
          enabled: this.channelOn(group, channel, prefs),
          locked: channel === 'inapp' && isGroupCritical(group),
        });
      }
    }
    return out;
  }

  async updatePrefs(
    userId: string,
    input: NotificationPrefsUpdateInput,
  ): Promise<NotificationPrefDto[]> {
    for (const u of input.updates) {
      if (u.channel === 'inapp' && isGroupCritical(u.typeGroup) && !u.enabled) {
        throw AppException.badRequest(
          'notifications.pref.locked',
          'In-app notifications for this group cannot be disabled',
          { typeGroup: u.typeGroup },
        );
      }
    }
    for (const u of input.updates) {
      await this.db
        .insert(notificationPrefs)
        .values({
          userId,
          typeGroup: u.typeGroup,
          channel: u.channel,
          enabled: u.enabled,
        })
        .onConflictDoUpdate({
          target: [
            notificationPrefs.userId,
            notificationPrefs.typeGroup,
            notificationPrefs.channel,
          ],
          set: { enabled: u.enabled, updatedAt: new Date() },
        });
    }
    this.audit.log({ action: 'notifications.prefs.updated', actorId: userId });
    return this.getPrefs(userId);
  }

  private async prefRows(userId: string): Promise<Map<string, boolean>> {
    const rows = await this.db
      .select({
        typeGroup: notificationPrefs.typeGroup,
        channel: notificationPrefs.channel,
        enabled: notificationPrefs.enabled,
      })
      .from(notificationPrefs)
      .where(eq(notificationPrefs.userId, userId));
    return new Map(rows.map((r) => [`${r.typeGroup}:${r.channel}`, r.enabled]));
  }

  private channelOn(
    group: NotificationGroup,
    channel: NotificationChannel,
    prefs: Map<string, boolean>,
  ): boolean {
    // In-app of a critical group is always on and can't be disabled (docs/07).
    if (channel === 'inapp' && isGroupCritical(group)) return true;
    return prefs.get(`${group}:${channel}`) ?? DEFAULT_ENABLED;
  }

  private toDto(row: NotificationRow): NotificationDto {
    return {
      id: row.id,
      type: row.type,
      group: groupOfType(row.type),
      title: row.title,
      body: row.body,
      entityType: row.entityType,
      entityId: row.entityId,
      isRead: row.isRead,
      readAt: row.readAt ? row.readAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
