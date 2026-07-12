import { z } from 'zod';
import { ACL_LEVELS, ACL_RESOURCE_TYPES, ACL_SUBJECT_TYPES } from '../enums/index';
import { PERMISSIONS } from '../permissions/index';

const permissionSet = new Set<string>(PERMISSIONS);
const permissionArray = z
  .array(z.string())
  .refine((codes) => codes.every((c) => permissionSet.has(c)), {
    message: 'contains an unknown permission',
  });

/** A role code: lowercase snake/kebab identifier (system codes are latin). */
const roleCode = z
  .string()
  .min(2)
  .max(48)
  .regex(/^[a-z][a-z0-9_]*$/, 'must be a lowercase identifier');

export const createRoleSchema = z.object({
  code: roleCode,
  name: z.string().min(1).max(120),
  permissions: permissionArray.default([]),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  permissions: permissionArray.optional(),
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

export const assignRoleSchema = z.object({
  userId: z.string().uuid(),
  roleId: z.string().uuid(),
  /** Org-unit scope (permissions apply to that unit + subtree); null = global. */
  orgUnitId: z.string().uuid().nullish(),
});
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;

export const grantAclSchema = z.object({
  resourceType: z.enum(ACL_RESOURCE_TYPES),
  resourceId: z.string().uuid(),
  subjectType: z.enum(ACL_SUBJECT_TYPES),
  subjectId: z.string().uuid(),
  level: z.enum(ACL_LEVELS),
});
export type GrantAclInput = z.infer<typeof grantAclSchema>;

export interface RoleDto {
  id: string;
  code: string;
  name: string;
  isSystem: boolean;
  permissions: string[];
}

export interface RoleAssignmentDto {
  id: string;
  userId: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  orgUnitId: string | null;
  orgUnitName: string | null;
}

export interface AclEntryDto {
  id: string;
  resourceType: string;
  resourceId: string;
  subjectType: string;
  subjectId: string;
  level: string;
}

export interface PermissionCatalogEntry {
  module: string;
  code: string;
}
