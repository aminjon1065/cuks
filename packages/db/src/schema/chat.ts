import { sql } from 'drizzle-orm';
import { boolean, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { CHANNEL_KINDS, CHANNEL_MEMBER_ROLES, CHAT_NOTIFY_LEVELS } from '@cuks/shared';
import { appSchema, createdAt, deletedAt, primaryId, updatedAt } from './_shared';
import { orgUnits } from './org';
import { users } from './users';

/**
 * Conversations (docs/modules/13 §2/§3, task 5.1): public/private channels, an auto-provisioned
 * channel per org unit, ЧС channels, and (group) direct messages. `last_message_at` orders the
 * conversation list; `name`/`topic` are null for DMs (rendered from the member list).
 */
export const chatChannels = appSchema.table(
  'chat_channels',
  {
    id: primaryId(),
    kind: text('kind', { enum: CHANNEL_KINDS }).notNull(),
    name: text('name'),
    topic: text('topic'),
    orgUnitId: uuid('org_unit_id').references(() => orgUnits.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    isArchived: boolean('is_archived').notNull().default(false),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    // One live org channel per org unit (auto-provisioning is idempotent on this).
    uniqueIndex('chat_channels_org_unit_uq')
      .on(t.orgUnitId)
      .where(sql`${t.kind} = 'org' and ${t.deletedAt} is null`),
    index('chat_channels_kind_idx').on(t.kind),
    index('chat_channels_last_message_idx').on(t.lastMessageAt),
  ],
);

/**
 * Channel membership (docs/modules/13 §3). `last_read_message_id` drives unread counters; it is a
 * plain uuid (no FK) because chat_messages is month-partitioned. `is_pinned` is a personal bookmark.
 */
export const chatMembers = appSchema.table(
  'chat_members',
  {
    id: primaryId(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => chatChannels.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    memberRole: text('member_role', { enum: CHANNEL_MEMBER_ROLES }).notNull().default('member'),
    lastReadMessageId: uuid('last_read_message_id'),
    notifyLevel: text('notify_level', { enum: CHAT_NOTIFY_LEVELS }).notNull().default('all'),
    isPinned: boolean('is_pinned').notNull().default(false),
    joinedAt: createdAt(),
  },
  (t) => [
    uniqueIndex('chat_members_channel_user_uq').on(t.channelId, t.userId),
    index('chat_members_user_idx').on(t.userId),
  ],
);

/** Emoji reactions (docs/modules/13 §3) — one per (message, user, emoji). `message_id` is a plain
 *  uuid: chat_messages is partitioned, so there is no FK to it. */
export const chatReactions = appSchema.table(
  'chat_reactions',
  {
    id: primaryId(),
    messageId: uuid('message_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('chat_reactions_uq').on(t.messageId, t.userId, t.emoji),
    index('chat_reactions_message_idx').on(t.messageId),
  ],
);

/** Pinned messages of a channel (docs/modules/13 §3). `message_id` is a plain uuid (partitioned). */
export const chatPins = appSchema.table(
  'chat_pins',
  {
    id: primaryId(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => chatChannels.id, { onDelete: 'cascade' }),
    messageId: uuid('message_id').notNull(),
    pinnedBy: uuid('pinned_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('chat_pins_channel_message_uq').on(t.channelId, t.messageId)],
);
