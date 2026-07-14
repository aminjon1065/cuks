import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { appSchema, createdAt, primaryId, updatedAt } from './_shared';

/**
 * Durable domain-event handoff for notification fan-out. Producers insert the
 * marker in the same transaction as their domain mutation; API dispatchers
 * claim pending rows with `FOR UPDATE SKIP LOCKED` and downstream notification
 * dedupe makes delivery safe to retry after an ambiguous process failure.
 */
export const notificationOutbox = appSchema.table(
  'notification_outbox',
  {
    id: primaryId(),
    topic: text('topic').notNull(),
    payload: jsonb('payload').$type<unknown>().notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('notification_outbox_dedupe_uq').on(t.dedupeKey),
    index('notification_outbox_pending_idx')
      .on(t.nextAttemptAt, t.createdAt)
      .where(sql`${t.processedAt} is null`),
    check('notification_outbox_attempts_chk', sql`${t.attempts} >= 0`),
  ],
);
