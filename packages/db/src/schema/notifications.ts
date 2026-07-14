import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  jsonb,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { NotificationPayload } from '@cuks/shared';
import { NOTIFICATION_CHANNELS } from '@cuks/shared';
import { appSchema, createdAt, primaryId, updatedAt } from './_shared';
import { users } from './users';

/**
 * Per-user notification feed (docs/07 §notifications). System-generated records —
 * no soft-delete; `is_read`/`read_at` are the only mutable state. The index backs
 * the feed + unread-count query.
 */
export const notifications = appSchema.table(
  'notifications',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    entityType: text('entity_type'),
    entityId: uuid('entity_id'),
    payload: jsonb('payload').$type<NotificationPayload>().notNull().default({}),
    // Optional domain-event identity. A retry may fan out again, but each user
    // receives at most one row for the same event.
    dedupeKey: text('dedupe_key'),
    isRead: boolean('is_read').notNull().default(false),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('notifications_user_read_created_idx').on(t.userId, t.isRead, t.createdAt.desc()),
    uniqueIndex('notifications_user_dedupe_uq')
      .on(t.userId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
  ],
);

/**
 * Per-user notification channel preferences (docs/07 §notification_prefs). One row
 * per (user, type_group, channel). In-app for critical groups can't be disabled —
 * enforced in the service, not the DB. Absent rows fall back to channel defaults.
 */
export const notificationPrefs = appSchema.table(
  'notification_prefs',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    typeGroup: text('type_group').notNull(),
    channel: text('channel', { enum: NOTIFICATION_CHANNELS }).notNull(),
    enabled: boolean('enabled').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('notification_prefs_user_group_channel_uq').on(t.userId, t.typeGroup, t.channel),
    check('notification_prefs_channel_chk', sql`${t.channel} in ('inapp', 'email')`),
  ],
);
