/**
 * RBAC/CASL vocabulary and catalog (docs/05-auth-rbac.md §3–5).
 * The full ability builder (CASL) is wired in phase 0.5; this is the shared
 * source of truth used by the DB seed, backend guards, and frontend UI-hiding.
 */

export const ACTIONS = ['manage', 'create', 'read', 'update', 'delete'] as const;
export type Action = (typeof ACTIONS)[number];

/**
 * Permission catalog v1 (docs/05 §4). Codes are `module.action`. A superadmin
 * holds the wildcard `*` (bypass — handled by the ability builder in 0.5).
 */
export const PERMISSIONS = [
  // admin
  'admin.users.manage',
  'admin.org.manage',
  'admin.roles.manage',
  'admin.dicts.manage',
  'admin.settings.manage',
  'admin.audit.view',
  'admin.substitutions.manage',
  'admin.system.monitor',
  // files
  'files.use',
  'files.org.manage',
  // gis
  'gis.view',
  'incidents.create',
  'incidents.manage',
  'gis.layers.edit',
  'gis.layers.manage',
  'gis.import',
  'gis.export',
  'gis.pg.access',
  // analytics
  'analytics.view',
  'analytics.build',
  // docflow
  'docflow.use',
  'docflow.create',
  'docflow.register',
  'docflow.journals.manage',
  'docflow.sign',
  'docflow.resolve',
  'docflow.control',
  'docflow.reports.view',
  'docflow.confidential.view',
  // tasks
  'tasks.use',
  'tasks.projects.create',
  // chat
  'chat.use',
  'chat.channels.create',
  'chat.admin',
  // meet
  'meet.use',
  'meet.record',
  'meet.recordings.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Wildcard permission granting everything (superadmin bypass). */
export const PERMISSION_WILDCARD = '*' as const;

/** Module a permission belongs to (for the admin roles matrix — docs/16 §3). */
export function permissionModule(code: string): string {
  const head = code.split('.')[0] ?? code;
  return head === 'incidents' ? 'gis' : head;
}

/** The permission catalog grouped by module (frontend renders RU text via i18n). */
export function permissionCatalog(): { module: string; code: string }[] {
  return PERMISSIONS.map((code) => ({ module: permissionModule(code), code }));
}

/** Permissions that require TOTP 2FA to be enabled (docs/05 §1). */
export const PERMISSIONS_REQUIRING_2FA: readonly string[] = [
  'admin.users.manage',
  'admin.org.manage',
  'admin.roles.manage',
  'admin.dicts.manage',
  'admin.settings.manage',
  'admin.audit.view',
  'admin.system.monitor',
  'docflow.sign',
  'gis.pg.access',
];

/** Convenience groups referenced by the role templates below. */
const BASE_USER: readonly Permission[] = [
  'files.use',
  'docflow.use',
  'tasks.use',
  'chat.use',
  'meet.use',
  'gis.view',
  'analytics.view',
];

/**
 * Role templates seeded on install (docs/05 §5). The admin may edit/add roles
 * afterwards. `system` roles cannot be deleted. Fuzzy spec entries (e.g.
 * "chat.*базовое*", "всё пользовательское") are resolved to concrete
 * permissions here — see docs/plan/STATUS.md "Принятые решения".
 */
export interface RoleTemplate {
  code: string;
  name: string;
  system: boolean;
  /** Explicit permission list, or `[PERMISSION_WILDCARD]` for full bypass. */
  permissions: readonly (Permission | typeof PERMISSION_WILDCARD)[];
}

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  {
    code: 'superadmin',
    name: 'Суперадмин',
    system: true,
    permissions: [PERMISSION_WILDCARD],
  },
  {
    code: 'platform_admin',
    name: 'Администратор платформы',
    system: true,
    permissions: [
      'admin.users.manage',
      'admin.org.manage',
      'admin.roles.manage',
      'admin.dicts.manage',
      'admin.settings.manage',
      'admin.audit.view',
      'admin.substitutions.manage',
      'admin.system.monitor',
      'files.use',
      'chat.use',
      'meet.use',
      'tasks.use',
    ],
  },
  {
    code: 'chief',
    name: 'Руководитель',
    system: true,
    permissions: [
      ...BASE_USER,
      'docflow.create',
      'docflow.sign',
      'docflow.resolve',
      'docflow.control',
      'docflow.reports.view',
      'docflow.confidential.view',
      'incidents.create',
      'incidents.manage',
      'analytics.build',
      'meet.record',
      'chat.channels.create',
      'tasks.projects.create',
    ],
  },
  {
    code: 'duty_officer',
    name: 'Оперативный дежурный',
    system: true,
    permissions: [
      'gis.view',
      'incidents.create',
      'incidents.manage',
      'analytics.view',
      'chat.use',
      'chat.channels.create',
      'meet.use',
      'meet.record',
      'tasks.use',
      'files.use',
      'docflow.use',
    ],
  },
  {
    code: 'clerk',
    name: 'Делопроизводитель',
    system: true,
    permissions: [
      'docflow.use',
      'docflow.create',
      'docflow.register',
      'docflow.control',
      'docflow.reports.view',
      'docflow.confidential.view',
      'files.use',
      'chat.use',
      'tasks.use',
    ],
  },
  {
    code: 'gis_analyst',
    name: 'Аналитик ГИС',
    system: true,
    permissions: [
      'gis.view',
      'incidents.create',
      'incidents.manage',
      'gis.layers.edit',
      'gis.layers.manage',
      'gis.import',
      'gis.export',
      'gis.pg.access',
      'analytics.view',
      'analytics.build',
      'files.use',
      'chat.use',
      'tasks.use',
      'meet.use',
    ],
  },
  {
    code: 'employee',
    name: 'Сотрудник',
    system: true,
    permissions: [...BASE_USER, 'docflow.create'],
  },
];
