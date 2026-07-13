/**
 * Domain enums shared by the DB schema (text + CHECK) and the frontend.
 * Single source of truth: the Drizzle schema imports these arrays so DB and UI
 * never drift (docs/04 §TypeScript — `as const` unions, no TS `enum`).
 */

export const USER_STATUSES = ['active', 'blocked'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const THEMES = ['system', 'light', 'dark'] as const;
export type Theme = (typeof THEMES)[number];

export const ORG_UNIT_TYPES = ['committee', 'department', 'division', 'unit'] as const;
export type OrgUnitType = (typeof ORG_UNIT_TYPES)[number];

export const ACL_SUBJECT_TYPES = ['user', 'org_unit', 'role'] as const;
export type AclSubjectType = (typeof ACL_SUBJECT_TYPES)[number];

export const ACL_RESOURCE_TYPES = [
  'folder',
  'file',
  'layer',
  'project',
  'channel',
  'recording',
  'report',
] as const;
export type AclResourceType = (typeof ACL_RESOURCE_TYPES)[number];

export const ACL_LEVELS = ['viewer', 'editor', 'manager'] as const;
export type AclLevel = (typeof ACL_LEVELS)[number];

/** ACL levels are ordered viewer < editor < manager (docs/05 §3). */
export const ACL_LEVEL_RANK: Record<AclLevel, number> = { viewer: 1, editor: 2, manager: 3 };

/** True if `have` grants at least `need`. */
export function aclLevelSatisfies(have: AclLevel, need: AclLevel): boolean {
  return ACL_LEVEL_RANK[have] >= ACL_LEVEL_RANK[need];
}

/** fs_nodes (docs/modules/12 §3). */
export const FS_NODE_KINDS = ['folder', 'file'] as const;
export type FsNodeKind = (typeof FS_NODE_KINDS)[number];

/** `system` = module attachments (docflow, chat, …), not shown in the file tree. */
export const FS_SPACES = ['personal', 'org', 'system'] as const;
export type FsSpace = (typeof FS_SPACES)[number];

/** ClamAV verdict on a file_version (docs/09 §2). */
export const AV_STATUSES = ['pending', 'clean', 'infected'] as const;
export type AvStatus = (typeof AV_STATUSES)[number];

/**
 * Dictionary types (docs/07 §dictionaries). Extended as modules land; the full
 * incident-type tree is seeded in phase 2.1 (docs/modules/10).
 */
export const DICTIONARY_TYPES = [
  'incident_type',
  'hazard_level',
  'doc_type',
  'correspondent_category',
] as const;
export type DictionaryType = (typeof DICTIONARY_TYPES)[number];
