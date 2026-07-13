import { jsonb, pgSchema, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

/**
 * Type/query mirror for `audit.audit_log` (docs/07 §audit). This file lives OUTSIDE
 * `src/schema/*`, so drizzle-kit never diffs or manages it — the real DDL is a
 * hand-written migration because the physical table is RANGE-partitioned by month
 * on `created_at` (which drizzle can't express) and its PK is composite
 * `(id, created_at)` (a partition-key requirement). Keep the columns here in sync
 * with that migration by hand.
 */
export const auditSchema = pgSchema('audit');

export const auditLog = auditSchema.table('audit_log', {
  id: uuid('id')
    .notNull()
    .$defaultFn(() => uuidv7()),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  orgUnitId: uuid('org_unit_id'),
  ip: text('ip'),
  userAgent: text('user_agent'),
  meta: jsonb('meta'),
});

export type AuditLogRow = typeof auditLog.$inferSelect;
