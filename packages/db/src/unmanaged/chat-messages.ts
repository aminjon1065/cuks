import { sql } from 'drizzle-orm';
import { jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { CHAT_MESSAGE_KINDS } from '@cuks/shared';

/**
 * Type/query mirror for `app.chat_messages` (docs/modules/13 §3, task 5.1). This file lives OUTSIDE
 * `src/schema/*`, so drizzle-kit never diffs or manages it — the real DDL is a hand-written migration
 * because the physical table is RANGE-partitioned by month on `created_at` (which drizzle can't
 * express) and its PK is composite `(id, created_at)` (a partition-key requirement). `channel_id` /
 * `author_id` / `reply_to_id` are plain uuids (no FK to a partitioned parent). The generated
 * `search_tsv` column is queried via raw SQL and omitted here. Keep the columns in sync by hand.
 */
const chatAppSchema = pgSchema('app');

export const chatMessages = chatAppSchema.table('chat_messages', {
  id: uuid('id')
    .notNull()
    .$defaultFn(() => uuidv7()),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  channelId: uuid('channel_id').notNull(),
  authorId: uuid('author_id'),
  kind: text('kind', { enum: CHAT_MESSAGE_KINDS }).notNull().default('text'),
  body: jsonb('body'),
  bodyText: text('body_text'),
  replyToId: uuid('reply_to_id'),
  fileIds: uuid('file_ids')
    .array()
    .notNull()
    .default(sql`'{}'::uuid[]`),
  editedAt: timestamp('edited_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export type ChatMessageRow = typeof chatMessages.$inferSelect;
