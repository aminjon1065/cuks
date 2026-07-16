import { index, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { appSchema, createdAt, primaryId } from './_shared';
import { users } from './users';

/**
 * Generic cross-entity links (docs/modules/15 §2/§6 «entity_links», task 4.5). A directed link
 * relates a source entity to a target by (`type`, `id`) — polymorphic like `comments`, so no FK
 * (the target may be a task, incident, document or channel). Tasks are the first consumer: a
 * `source = task` linked to a `target = incident|document`, shown on both sides.
 */
export const entityLinks = appSchema.table(
  'entity_links',
  {
    id: primaryId(),
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id').notNull(),
    targetType: text('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('entity_links_pair_uq').on(t.sourceType, t.sourceId, t.targetType, t.targetId),
    index('entity_links_source_idx').on(t.sourceType, t.sourceId),
    index('entity_links_target_idx').on(t.targetType, t.targetId),
  ],
);
