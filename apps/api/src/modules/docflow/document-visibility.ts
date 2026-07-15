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

/** Whether the user may view ДСП documents at all — holds `docflow.confidential.view`
 *  (docs/09-security.md §3). The permission is necessary but not sufficient: the user must
 *  ALSO be on the document's access list (checked by the caller). */
export function hasConfidentialAccess(
  user: Pick<AuthUser, 'permissions' | 'isSuperadmin'>,
): boolean {
  return user.isSuperadmin || user.permissions.includes('docflow.confidential.view');
}

/**
 * Base document visibility (docs/modules/11 §2, docs/09-security.md §3). Author/superadmin
 * always; ДСП documents require `docflow.confidential.view` AND access-list membership (the
 * grif never yields to registry access); non-ДСП documents are visible to access-list members
 * and to the chancellery/control registry. Route/resolution participants extend this
 * asynchronously (tasks 3.3/3.4) — but for ДСП that extension is also gated on the permission
 * (see assertVisible). Pure + sync so it can gate a list query row-by-row without round-trips.
 */
export function canViewDocumentBase(
  doc: Pick<typeof documents.$inferSelect, 'authorId' | 'accessList' | 'confidentiality'>,
  user: Pick<AuthUser, 'id' | 'permissions' | 'isSuperadmin'>,
): boolean {
  if (user.isSuperadmin) return true;
  if (doc.authorId === user.id) return true;
  if (doc.confidentiality === 'dsp') {
    // ДСП: allow-list ∩ право (docs/09 §3). Both conditions required, no registry fallback.
    return doc.accessList.includes(user.id) && hasConfidentialAccess(user);
  }
  if (doc.accessList.includes(user.id)) return true;
  return hasRegistryAccess(user);
}
