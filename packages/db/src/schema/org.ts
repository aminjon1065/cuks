import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { ORG_UNIT_TYPES } from '@cuks/shared';
import { appSchema, createdAt, deletedAt, primaryId, updatedAt } from './_shared';
import { users } from './users';

/** org_units — tree with a materialized `path` for fast subtree queries (docs/05 §2). */
export const orgUnits = appSchema.table(
  'org_units',
  {
    id: primaryId(),
    parentId: uuid('parent_id'),
    name: text('name').notNull(),
    shortName: text('short_name'),
    type: text('type', { enum: ORG_UNIT_TYPES }).notNull(),
    // Materialized path of ancestor ids joined by '.', e.g. `<root>.<a>.<b>`.
    path: text('path').notNull(),
    sort: integer('sort').notNull().default(0),
    // No FK: would create an org_units <-> positions cycle; integrity in app.
    headPositionId: uuid('head_position_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    foreignKey({
      columns: [t.parentId],
      foreignColumns: [t.id],
      name: 'org_units_parent_fk',
    }).onDelete('restrict'),
    index('org_units_parent_idx').on(t.parentId),
    index('org_units_path_idx').on(t.path),
    check('org_units_type_chk', sql`${t.type} in ('committee', 'department', 'division', 'unit')`),
  ],
);

/** positions — posts within an org unit (docs/05 §2). */
export const positions = appSchema.table(
  'positions',
  {
    id: primaryId(),
    orgUnitId: uuid('org_unit_id')
      .notNull()
      .references(() => orgUnits.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    rank: integer('rank').notNull().default(0),
    isHead: boolean('is_head').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [index('positions_org_unit_idx').on(t.orgUnitId)],
);

/** user_positions — a user holds 1+ positions; exactly one is primary (docs/05 §2). */
export const userPositions = appSchema.table(
  'user_positions',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    positionId: uuid('position_id')
      .notNull()
      .references(() => positions.id, { onDelete: 'restrict' }),
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('user_positions_user_position_uq').on(t.userId, t.positionId),
    index('user_positions_position_idx').on(t.positionId),
  ],
);
