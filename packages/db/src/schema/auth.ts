import { index, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { appSchema, createdAt, primaryId } from './_shared';
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
