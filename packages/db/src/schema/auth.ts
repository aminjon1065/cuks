import { boolean, index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { SUBSTITUTION_SCOPES } from '@cuks/shared';
import { appSchema, createdAt, deletedAt, primaryId, updatedAt } from './_shared';
import { users } from './users';

/**
 * One-time TOTP backup codes (docs/05 §1). Codes are stored hashed (sha256);
 * `used_at` marks consumption. Sessions live in Redis, not the DB.
 */
export const totpBackupCodes = appSchema.table(
  'totp_backup_codes',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('totp_backup_codes_user_hash_uq').on(t.userId, t.codeHash),
    index('totp_backup_codes_user_idx').on(t.userId),
  ],
);

/**
 * Substitutions / deputies (docs/05-auth-rbac.md §6, task 3.11). While active and within its
 * window, the deputy sees and executes the principal's route steps — the acting user stays the
 * deputy (`acted_by`), the step's `assignee_id` stays the principal, and a signature carries an
 * `on_behalf_of` marker («за»). `scope` is `all` or `docflow` (both cover docflow today). A null
 * `starts_at`/`ends_at` means open-ended; `is_active` is the manual on/off; soft-deleted rows keep
 * the history. Configured by the principal (a leader delegating their own duties) or an admin.
 */
export const substitutions = appSchema.table(
  'substitutions',
  {
    id: primaryId(),
    principalId: uuid('principal_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deputyId: uuid('deputy_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: SUBSTITUTION_SCOPES }).notNull().default('docflow'),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    // The deputy's «за кого» lookup: active substitutions where I am the deputy.
    index('substitutions_deputy_idx').on(t.deputyId, t.isActive),
    index('substitutions_principal_idx').on(t.principalId),
  ],
);
