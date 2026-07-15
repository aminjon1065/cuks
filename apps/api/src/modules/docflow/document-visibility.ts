import type { documents } from '@cuks/db';
import type { AuthUser } from '../../common/auth/auth-user';

/** Permissions that let a user see the whole (non-ДСП) registry, not just their own. */
export const DOCFLOW_REGISTRY_PERMISSIONS = ['docflow.register', 'docflow.control'];

/** True if the user may see the non-ДСП registry (chancellery / control) or is superadmin. */
export function hasRegistryAccess(user: Pick<AuthUser, 'permissions' | 'isSuperadmin'>): boolean {
  return (
    user.isSuperadmin || user.permissions.some((p) => DOCFLOW_REGISTRY_PERMISSIONS.includes(p))
  );
}

/**
 * Base document visibility (docs/modules/11 §2). Participants (author + access-list)
 * always; the non-ДСП registry additionally to the chancellery/control; ДСП stays
 * allow-list-only even for other chancelleries. Route/resolution participants extend
 * this asynchronously (tasks 3.3/3.4); owner-unit leadership in 3.8. Pure + sync so
 * it can gate a list query row-by-row without extra round-trips.
 */
export function canViewDocumentBase(
  doc: Pick<typeof documents.$inferSelect, 'authorId' | 'accessList' | 'confidentiality'>,
  user: Pick<AuthUser, 'id' | 'permissions' | 'isSuperadmin'>,
): boolean {
  if (user.isSuperadmin) return true;
  if (doc.authorId === user.id) return true;
  if (doc.accessList.includes(user.id)) return true;
  if (doc.confidentiality === 'dsp') return false;
  return hasRegistryAccess(user);
}
