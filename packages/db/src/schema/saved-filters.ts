import { boolean, index, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { appSchema, createdAt, deletedAt, primaryId, updatedAt } from './_shared';
import { users } from './users';

/** Per-user reusable registry/analytics query presets (docs/07 §saved_filters). */
export const savedFilters = appSchema.table(
  'saved_filters',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    module: text('module').notNull(),
    name: text('name').notNull(),
    params: jsonb('params').notNull(),
    isShared: boolean('is_shared').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('saved_filters_user_module_idx').on(t.userId, t.module, t.createdAt),
    index('saved_filters_module_idx').on(t.module),
  ],
);
