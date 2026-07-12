import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { DICTIONARY_TYPES } from '@cuks/shared';
import { appSchema, createdAt, primaryId, updatedAt } from './_shared';

/**
 * dictionaries — reference data with a stable `code`, RU/TG names, optional tree
 * via `parent_code` (docs/07 §dictionaries). Large hierarchies (incident types)
 * may be split into a dedicated table later if needed.
 */
export const dictionaries = appSchema.table(
  'dictionaries',
  {
    id: primaryId(),
    type: text('type', { enum: DICTIONARY_TYPES }).notNull(),
    code: text('code').notNull(),
    parentCode: text('parent_code'),
    nameRu: text('name_ru').notNull(),
    nameTg: text('name_tg').notNull(),
    sort: integer('sort').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    meta: jsonb('meta')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('dictionaries_type_code_uq').on(t.type, t.code),
    index('dictionaries_type_active_sort_idx').on(t.type, t.isActive, t.sort),
  ],
);
