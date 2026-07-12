import { pgSchema, timestamp, uuid } from 'drizzle-orm/pg-core';
import { uuidv7 } from 'uuidv7';

/** Business + core schema (docs/04 §DB: schemas `app`, `gis`, `audit`). */
export const appSchema = pgSchema('app');

/** UUIDv7 primary key (sortable by time — ADR-14). Generated client-side. */
export const primaryId = () =>
  uuid('id')
    .primaryKey()
    .$defaultFn(() => uuidv7());

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true }).defaultNow().notNull();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date());

/** Soft-delete marker for user data (docs/04 §DB). */
export const deletedAt = () => timestamp('deleted_at', { withTimezone: true });
