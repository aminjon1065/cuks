import { text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';
import { auditSchema } from './audit-log';

/**
 * Type/query mirror for `audit.read_log` (docs/09 §3, docs/07 §read_log): the ДСП access
 * trail — who opened a restricted document (`entity_type='document'`) or downloaded its file
 * (`entity_type='file'`). Like {@link ./audit-log}, this lives OUTSIDE `src/schema/*` so
 * drizzle-kit never manages the `audit` schema; the real DDL is a hand-written migration and
 * the table is append-only (UPDATE/DELETE denied to the app role at deployment). Keep the
 * columns in sync with the migration by hand.
 */
export const readLog = auditSchema.table('read_log', {
  id: uuid('id')
    .notNull()
    .$defaultFn(() => uuidv7()),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  actorId: uuid('actor_id').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  ip: text('ip'),
  userAgent: text('user_agent'),
});

export type ReadLogRow = typeof readLog.$inferSelect;
