import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { LOCALES, THEMES, USER_STATUSES } from '@cuks/shared';
import { appSchema, createdAt, deletedAt, primaryId, updatedAt } from './_shared';

/** users (docs/07 §Таблицы ядра). Accounts are created by admins only. */
export const users = appSchema.table(
  'users',
  {
    id: primaryId(),
    username: text('username').notNull(),
    passwordHash: text('password_hash').notNull(),
    fullName: text('full_name').notNull(),
    shortName: text('short_name').notNull(), // И.О. Фамилия
    email: text('email'),
    phone: text('phone'),
    // FK to app.files is added in phase 1 when the files table lands.
    avatarFileId: uuid('avatar_file_id'),
    status: text('status', { enum: USER_STATUSES }).notNull().default('active'),
    totpSecret: text('totp_secret'), // encrypted at the application layer
    totpEnabled: boolean('totp_enabled').notNull().default(false),
    mustChangePassword: boolean('must_change_password').notNull().default(false),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    locale: text('locale', { enum: LOCALES }).notNull().default('ru'),
    theme: text('theme', { enum: THEMES }).notNull().default('system'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    createdBy: uuid('created_by'),
  },
  (t) => [
    // Partial unique: a soft-deleted row must not block reusing the username.
    uniqueIndex('users_username_uq')
      .on(t.username)
      .where(sql`${t.deletedAt} is null`),
    foreignKey({
      columns: [t.createdBy],
      foreignColumns: [t.id],
      name: 'users_created_by_fk',
    }).onDelete('restrict'),
    check('users_status_chk', sql`${t.status} in ('active', 'blocked')`),
    check('users_locale_chk', sql`${t.locale} in ('ru', 'tg')`),
    check('users_theme_chk', sql`${t.theme} in ('system', 'light', 'dark')`),
  ],
);
