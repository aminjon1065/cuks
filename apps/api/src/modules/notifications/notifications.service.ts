import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, inArray, like } from 'drizzle-orm';
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
  type NotificationPayload,
  type NotificationPriority,
  type NotificationPrefDto,
  type NotificationPrefsUpdateInput,
  type PaginatedResult,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import { DB } from '../../common/db/db.module';
import { AppException } from '../../common/exceptions/app.exception';
import { MailService } from '../../common/mail/mail.service';
import { RealtimeService } from '../events/realtime.service';
import { PresenceService, type PresenceState } from '../events/presence.service';

/** Channels default to on; a stored pref row overrides. */
const DEFAULT_ENABLED = true;
export const OFFLINE_EMAIL_THRESHOLD_MS = 5 * 60 * 1_000;
const DUSHANBE_UTC_OFFSET_MS = 5 * 60 * 60 * 1_000;
const QUIET_START_HOUR = 21;
const QUIET_END_HOUR = 7;

export type EmailDeliveryMode = 'offline' | 'always' | 'never';

export interface EmailDeliveryPlan {
  send: boolean;
  delayMs: number;
}

/** Default 21:00–07:00 quiet window in Asia/Dushanbe (UTC+5, no DST). */
export function quietHoursDelayMs(now: number): number {
  const local = new Date(now + DUSHANBE_UTC_OFFSET_MS);
  const hour = local.getUTCHours();
  if (hour >= QUIET_START_HOUR) {
    return (
      ((24 - hour + QUIET_END_HOUR) * 60 * 60 -
        local.getUTCMinutes() * 60 -
        local.getUTCSeconds()) *
        1_000 -
      local.getUTCMilliseconds()
    );
  }
  if (hour < QUIET_END_HOUR) {
    return (
      ((QUIET_END_HOUR - hour) * 60 * 60 - local.getUTCMinutes() * 60 - local.getUTCSeconds()) *
        1_000 -
      local.getUTCMilliseconds()
    );
  }
  return 0;
}

export function planEmailDelivery(
  priority: NotificationPriority,
  mode: EmailDeliveryMode,
  presence: PresenceState,
  now: number,
): EmailDeliveryPlan {
  if (mode === 'never') return { send: false, delayMs: 0 };
  if (priority === 'critical') return { send: true, delayMs: 0 };
  if (
    mode === 'offline' &&
    (presence.online || presence.offlineForMs < OFFLINE_EMAIL_THRESHOLD_MS)
  ) {
    return { send: false, delayMs: 0 };
  }
  return { send: true, delayMs: quietHoursDelayMs(now) };
}

type NotificationRow = typeof notifications.$inferSelect;

export interface NotifyInput {
  userId: string;
  type: string;
  title: string;
  body: string;
  entityType?: string | null;
  entityId?: string | null;
  payload?: NotificationPayload;
  priority: NotificationPriority;
  emailMode: EmailDeliveryMode;
  /** Stable domain-event identity; deduplicated independently per recipient. */
  dedupeKey?: string;
  /** Email body override; falls back to `body`. */
  emailText?: string;
}

export interface NotifyManyInput extends Omit<NotifyInput, 'userId'> {
  userIds: readonly string[];
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
    private readonly presence: PresenceService,
  ) {}

  async notify(input: NotifyInput): Promise<void> {
    const { userId, ...message } = input;
    await this.notifyMany({ ...message, userIds: [userId] });
  }

  /** Batch fan-out without per-recipient preference/email queries. */
  async notifyMany(input: NotifyManyInput): Promise<void> {
    const userIds = [...new Set(input.userIds)];
    if (userIds.length === 0) return;

    const group = groupOfType(input.type);
    const prefs = await this.prefRowsForUsers(userIds);
    const inAppUserIds = userIds.filter((userId) =>
      this.channelOnForUser(userId, group, 'inapp', input.priority, prefs),
    );
    const emailUserIds = userIds.filter((userId) =>
      this.channelOnForUser(userId, group, 'email', input.priority, prefs),
    );

    const inserted = inAppUserIds.length
      ? await this.db
          .insert(notifications)
          .values(
            inAppUserIds.map((userId) => ({
              userId,
              type: input.type,
              title: input.title,
              body: input.body,
              entityType: input.entityType ?? null,
              entityId: input.entityId ?? null,
              payload: input.payload ?? {},
              dedupeKey: input.dedupeKey ?? null,
            })),
          )
          .onConflictDoNothing()
          .returning()
      : [];
    for (const row of inserted) {
      this.realtime.emitToUser(row.userId, 'notify.new', {
        id: row.id,
        type: row.type,
        createdAt: row.createdAt.toISOString(),
      });
    }

    const insertedUserIds = new Set(inserted.map((row) => row.userId));
    const eligibleEmailUserIds = emailUserIds.filter(
      (userId) => !input.dedupeKey || !inAppUserIds.includes(userId) || insertedUserIds.has(userId),
    );
    const now = Date.now();
    const emailPlans = await Promise.all(
      eligibleEmailUserIds.map(async (userId) => {
        const presence =
          input.priority === 'critical' || input.emailMode !== 'offline'
            ? { online: false, offlineForMs: Number.POSITIVE_INFINITY }
            : await this.presence.status(userId, now);
        return {
          userId,
          plan: planEmailDelivery(input.priority, input.emailMode, presence, now),
        };
      }),
    );
    const sendPlans = emailPlans.filter(({ plan }) => plan.send);
    if (sendPlans.length > 0) {
      const planByUserId = new Map(sendPlans.map((item) => [item.userId, item.plan]));
      const emailRows = await this.db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(
          inArray(
            users.id,
            sendPlans.map(({ userId }) => userId),
          ),
        );
      await Promise.all(
        emailRows
          .filter((user): user is typeof user & { email: string } => !!user.email)
          .map((user) => {
            const plan = planByUserId.get(user.id);
            if (!plan) return Promise.resolve();
            return this.mail.send(
              {
                to: user.email,
                subject: input.title,
                text: input.emailText ?? input.body,
              },
              {
                ...(plan.delayMs > 0 ? { delayMs: plan.delayMs } : {}),
                ...(input.dedupeKey ? { dedupeKey: `${input.dedupeKey}:email:${user.id}` } : {}),
              },
            );
          }),
      );
    }

    this.audit.log({
      action: 'notifications.notify',
      entityType: 'notification',
      meta: {
        type: input.type,
        group,
        priority: input.priority,
        emailMode: input.emailMode,
        recipientCount: userIds.length,
        insertedCount: inserted.length,
        emailCount: sendPlans.length,
      },
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

  private async prefRowsForUsers(userIds: readonly string[]): Promise<Map<string, boolean>> {
    const rows = await this.db
      .select({
        userId: notificationPrefs.userId,
        typeGroup: notificationPrefs.typeGroup,
        channel: notificationPrefs.channel,
        enabled: notificationPrefs.enabled,
      })
      .from(notificationPrefs)
      .where(inArray(notificationPrefs.userId, [...userIds]));
    return new Map(
      rows.map((row) => [`${row.userId}:${row.typeGroup}:${row.channel}`, row.enabled]),
    );
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

  private channelOnForUser(
    userId: string,
    group: NotificationGroup,
    channel: NotificationChannel,
    priority: NotificationPriority,
    prefs: Map<string, boolean>,
  ): boolean {
    if (channel === 'inapp' && (priority === 'critical' || isGroupCritical(group))) return true;
    return prefs.get(`${userId}:${group}:${channel}`) ?? DEFAULT_ENABLED;
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
      payload: row.payload,
      isRead: row.isRead,
      readAt: row.readAt ? row.readAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
