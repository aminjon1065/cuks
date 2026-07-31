import { and, eq, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  acquaintances,
  documentCollaborators,
  documents,
  resolutionProposals,
  resolutions,
  routeSteps,
  routes,
} from '@cuks/db';
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
 * True if the user may actually REGISTER and DISPATCH — the chancellery's own acts.
 *
 * Narrower than `hasRegistryAccess` on purpose: control (`docflow.control`) may see the
 * whole registry to supervise it, but minting a number and recording a send are not
 * supervision. The endpoints are guarded by `docflow.register` alone, so any capability flag
 * or available-action computed with the broader predicate would promise a button the
 * server's own guard then refuses.
 */
export function hasChancelleryRights(
  user: Pick<AuthUser, 'permissions' | 'isSuperadmin'>,
): boolean {
  return user.isSuperadmin || user.permissions.includes('docflow.register');
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

/**
 * Whether the user may change a document's grif / access list or read its ДСП trail
 * (docs/09-security.md §3): the author or superadmin, or a `docflow.confidential.view` holder
 * who can ALREADY view the document. The view requirement is what stops confidential.view alone
 * from reaching a ДСП document it is not on the допуск-список of (access_list ∩ право), while
 * still letting the chancellery classify a normal document it can see.
 */
export function canManageDocumentAccess(
  doc: Pick<typeof documents.$inferSelect, 'authorId' | 'accessList' | 'confidentiality'>,
  user: Pick<AuthUser, 'id' | 'permissions' | 'isSuperadmin'>,
): boolean {
  if (user.isSuperadmin) return true;
  if (doc.authorId === user.id) return true;
  return canViewDocumentBase(doc, user) && user.permissions.includes('docflow.confidential.view');
}

/**
 * The assignments a caller acts under — their own user id, the positions they hold and the
 * org units they head, plus everything they hold as an active deputy (docs/05 §6). Resolved
 * ONCE per request by `RoutesService`, never per row.
 */
export interface ActorAssignments {
  userIds: string[];
  positionIds: string[];
  orgUnitIds: string[];
}

/**
 * The ONE SQL expression for «which documents may this caller see» (docs/09-security.md §3,
 * docs/modules/11 §2, plan §6.11).
 *
 * Until now the same question had three different answers: this module's `canViewDocumentBase`
 * (row-by-row, knows no participation), `DocumentsService.assertVisible` (the card gate, knows
 * five kinds of participant) and a hand-built predicate inside the list query (knew two). They
 * disagreed in both directions — a route approver could open a document by link that the
 * register would not show them, and the acknowledgement report dropped rows for documents the
 * reader could in fact open. A search endpoint on top of three answers would just be a fourth.
 *
 * Two independent parts, ANDed:
 *
 *  1. **Involvement** — author, allow-list, collaborator, proposal signer, route assignee,
 *     resolution author/executor/co-executor, assigned reader — or, for the registry roles,
 *     the whole non-ДСП registry.
 *  2. **The ДСП guard** — allow-list ∩ `docflow.confidential.view`, applied on top and never
 *     widened by involvement. Being asked to approve a ДСП document does not admit you to it;
 *     the допуск-список does.
 *
 * The guard is a separate AND rather than a branch inside part 1 precisely so that no future
 * clause added to «involvement» can accidentally open ДСП: it would have to survive the guard.
 */
export function visibleDocumentsWhere(
  user: Pick<AuthUser, 'id' | 'permissions' | 'isSuperadmin'>,
  assignments: ActorAssignments,
): SQL {
  // Superadmin sees everything that is not deleted; the caller adds the deleted-at filter.
  if (user.isSuperadmin) return sql`true`;

  const involved = or(
    documentInvolvementWhere(user, assignments),
    // The registry roles see the registry — but only its non-ДСП half; the guard below is
    // what stops this clause from being a back door into the grif.
    hasRegistryAccess(user) ? ne(documents.confidentiality, 'dsp') : undefined,
  );

  // `and`/`or` return undefined only for an empty argument list, which cannot happen here —
  // but a silently-dropped visibility predicate is the one bug this file must never have, so
  // the fallback is «see nothing» rather than a non-null assertion.
  const both = and(involved ?? sql`false`, confidentialityGuard(user));
  return both ?? sql`false`;
}

/**
 * The ДСП half on its own: allow-list ∩ `docflow.confidential.view`, never widened by
 * anything (docs/09-security.md §3).
 *
 * Exported so a caller that has ALREADY narrowed to involvement — the «Мои документы» queue —
 * can apply the guard without paying for the involvement subqueries a second time. On a
 * register of two hundred thousand rows that duplication was worth about 100 ms a page.
 */
export function confidentialityGuard(
  user: Pick<AuthUser, 'id' | 'permissions' | 'isSuperadmin'>,
): SQL {
  if (user.isSuperadmin) return sql`true`;
  const guard = hasConfidentialAccess(user)
    ? or(
        ne(documents.confidentiality, 'dsp'),
        eq(documents.authorId, user.id),
        sql`${user.id}::uuid = any(${documents.accessList})`,
      )
    : or(ne(documents.confidentiality, 'dsp'), eq(documents.authorId, user.id));
  return guard ?? sql`false`;
}

/**
 * The caller's OWN involvement with a document — «моё», as opposed to «всё, что мне положено
 * видеть». Author, allow-list, collaborator, proposal signer, route assignee, resolution
 * author/executor/co-executor, assigned reader.
 *
 * Split out from {@link visibleDocumentsWhere} because the «Мои документы» queue means exactly
 * this and must NOT include the registry-wide clause: a clerk holding `docflow.register` sees
 * the whole register on the register tab, and their own documents on the personal one. Both
 * are the same rule applied at different widths, not two rules.
 *
 * On its own this expression does NOT carry the ДСП guard — it is only ever ANDed with the
 * full predicate, which does.
 */
export function documentInvolvementWhere(
  user: Pick<AuthUser, 'id'>,
  assignments: ActorAssignments,
): SQL {
  const involved = or(
    eq(documents.authorId, user.id),
    sql`${user.id}::uuid = any(${documents.accessList})`,
    sql`exists (select 1 from ${documentCollaborators} dc
      where dc.document_id = ${documents.id} and dc.user_id = ${user.id}::uuid
        and dc.deleted_at is null)`,
    sql`exists (select 1 from ${resolutionProposals} rp
      where rp.document_id = ${documents.id} and rp.signer_id = ${user.id}::uuid
        and rp.deleted_at is null)`,
    // Resolutions are never soft-deleted — an instruction that was given stays on the record,
    // so there is no `deleted_at` to filter on here.
    sql`exists (select 1 from ${resolutions} r
      where r.document_id = ${documents.id}
        and (r.author_id = ${user.id}::uuid or r.executor_id = ${user.id}::uuid
             or ${user.id}::uuid = any(r.co_executors)))`,
    sql`exists (select 1 from ${acquaintances} a
      where a.document_id = ${documents.id} and a.user_id = ${user.id}::uuid)`,
    routeAssigneeExists(assignments),
  );
  return involved ?? sql`false`;
}

/**
 * Route participation, as SQL. A step is matched by whatever the caller acts as — themselves,
 * a position they hold, a unit they head — which is why the assignments arrive resolved: the
 * substitution rules that produce them (docs/05 §6) are not expressible per row.
 *
 * No assignments at all means no route can match, and that is `false`, not «no filter».
 */
function routeAssigneeExists(a: ActorAssignments): SQL | undefined {
  const kinds: SQL[] = [];
  if (a.userIds.length) {
    kinds.push(sql`(rs.assignee_type = 'user' and rs.assignee_id in ${a.userIds})`);
  }
  if (a.positionIds.length) {
    kinds.push(sql`(rs.assignee_type = 'position' and rs.assignee_id in ${a.positionIds})`);
  }
  if (a.orgUnitIds.length) {
    kinds.push(sql`(rs.assignee_type = 'org_unit' and rs.assignee_id in ${a.orgUnitIds})`);
  }
  const match = or(...kinds);
  if (!match) return undefined;
  return sql`exists (select 1 from ${routeSteps} rs
    join ${routes} rt on rt.id = rs.route_id
    where rt.document_id = ${documents.id} and ${match})`;
}
