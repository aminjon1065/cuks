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
