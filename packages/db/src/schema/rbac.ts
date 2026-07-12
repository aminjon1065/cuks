import { sql } from 'drizzle-orm';
import { boolean, check, index, text, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { ACL_LEVELS, ACL_RESOURCE_TYPES, ACL_SUBJECT_TYPES } from '@cuks/shared';
import { appSchema, createdAt, deletedAt, primaryId, updatedAt } from './_shared';
import { orgUnits } from './org';
import { users } from './users';

/** roles — templates seeded on install; `is_system` roles cannot be deleted (docs/05 §5). */
export const roles = appSchema.table(
  'roles',
  {
    id: primaryId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [uniqueIndex('roles_code_uq').on(t.code)],
);

/** role_permissions — permission strings from the catalog (packages/shared). */
export const rolePermissions = appSchema.table(
  'role_permissions',
  {
    id: primaryId(),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'cascade' }),
    permission: text('permission').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('role_permissions_role_permission_uq').on(t.roleId, t.permission)],
);

/** user_roles — global or scoped to an org unit + its subtree (docs/05 §3). */
export const userRoles = appSchema.table(
  'user_roles',
  {
    id: primaryId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => roles.id, { onDelete: 'restrict' }),
    orgUnitId: uuid('org_unit_id').references(() => orgUnits.id, { onDelete: 'restrict' }),
    createdAt: createdAt(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    // A null scope is a global assignment; treat it as a single distinct value.
    unique('user_roles_user_role_scope_uq').on(t.userId, t.roleId, t.orgUnitId).nullsNotDistinct(),
    index('user_roles_user_idx').on(t.userId),
    index('user_roles_role_idx').on(t.roleId),
    index('user_roles_org_unit_idx').on(t.orgUnitId),
  ],
);

/** resource_acl — per-object ACL, level 3 of the rights model (docs/05 §3, docs/07). */
export const resourceAcl = appSchema.table(
  'resource_acl',
  {
    id: primaryId(),
    resourceType: text('resource_type', { enum: ACL_RESOURCE_TYPES }).notNull(),
    resourceId: uuid('resource_id').notNull(),
    subjectType: text('subject_type', { enum: ACL_SUBJECT_TYPES }).notNull(),
    subjectId: uuid('subject_id').notNull(),
    level: text('level', { enum: ACL_LEVELS }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'restrict' }),
  },
  (t) => [
    uniqueIndex('resource_acl_resource_subject_uq').on(
      t.resourceType,
      t.resourceId,
      t.subjectType,
      t.subjectId,
    ),
    index('resource_acl_resource_idx').on(t.resourceType, t.resourceId),
    index('resource_acl_subject_idx').on(t.subjectType, t.subjectId),
    check('resource_acl_level_chk', sql`${t.level} in ('viewer', 'editor', 'manager')`),
  ],
);
