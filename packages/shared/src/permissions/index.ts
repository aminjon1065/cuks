/**
 * RBAC/CASL vocabulary (docs/05-auth-rbac.md). Full ability catalog is built in
 * phase 0.5; this fixes the shared action vocabulary used by guards and the UI.
 */
export const ACTIONS = ['manage', 'create', 'read', 'update', 'delete'] as const;
export type Action = (typeof ACTIONS)[number];
