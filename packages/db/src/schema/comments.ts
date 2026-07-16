import { sql } from 'drizzle-orm';
import { index, text, uuid } from 'drizzle-orm/pg-core';
import { appSchema, createdAt, deletedAt, primaryId, updatedAt } from './_shared';
import { users } from './users';

/**
 * Generic comments (docs/modules/15 §2 «общая comments»). A comment is attached to any entity by
 * (`entity_type`, `entity_id`) — task cards are the first consumer (`entity_type = 'task'`). `body`
 * is plain text; `mentions` holds the ids of @-mentioned users (they are notified on insert). Soft-
 * deleted so the «История» stays coherent.
 */
export const comments = appSchema.table(
  'comments',
  {
    id: primaryId(),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    body: text('body').notNull(),
    mentions: uuid('mentions')
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('comments_entity_idx').on(t.entityType, t.entityId, t.createdAt)],
);
