import { and, eq, isNull } from 'drizzle-orm';
import { documentCollaborators, type Database } from '@cuks/db';
import {
  DOCUMENT_EDITING_ROLES,
  DOCUMENT_STATUS_TRANSITIONS,
  type DocumentAction,
  type DocClass,
  type DispositionStatus,
  type DocumentCollaboratorRole,
  type DocumentStatus,
} from '@cuks/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import {
  canManageDocumentAccess,
  hasChancelleryRights,
  hasRegistryAccess,
} from './document-visibility';

/**
 * The live collaborator roles a user holds on a document — the one input the action policy
 * needs from the database. It lives beside the policy rather than in the collaborators
 * service so `DocumentsService` can read it without importing that service, which would
 * close a require cycle and leave Nest resolving `undefined` for the DI metadata.
 */
export async function collaboratorRolesOf(
  db: Database,
  documentId: string,
  userId: string,
): Promise<DocumentCollaboratorRole[]> {
  const rows = await db
    .select({ role: documentCollaborators.role })
    .from(documentCollaborators)
    .where(
      and(
        eq(documentCollaborators.documentId, documentId),
        eq(documentCollaborators.userId, userId),
        isNull(documentCollaborators.deletedAt),
      ),
    );
  return rows.map((r) => r.role);
}

/** The document fields the action policy reasons over. */
export interface ActionableDocument {
  authorId: string;
  docClass: DocClass;
  status: DocumentStatus;
  confidentiality: 'normal' | 'dsp';
  accessList: string[];
  regNumber: string | null;
  archivedAt: Date | null;
  dispositionStatus: DispositionStatus;
}

/** Statuses a document may be filed away from — the same list `assertArchivable` enforces. */
const ARCHIVABLE_STATUSES: readonly DocumentStatus[] = ['registered', 'in_progress', 'completed'];

/**
 * Statuses whose requisites are still the author's to shape. Once a number is minted the
 * card is a record: correcting it is a separate, audited action (plan этап 2 приёмка), not
 * a silent edit. `rejected` is editable because rework is exactly what a rejection asks for.
 */
const EDITABLE_STATUSES: readonly DocumentStatus[] = ['draft', 'rejected'];

export function isEditableStatus(status: DocumentStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

/**
 * May this caller edit the document's requisites (docs/modules/11 §12.5)? The author
 * always may while the status allows it; a `preparer`/`editor` collaborator may too — the
 * point of the role. Everyone else may not, including the chancellery: registry access is
 * for finding and registering documents, not for rewriting somebody's draft.
 *
 * Pure, so the whole matrix is unit-tested and the same answer feeds `availableActions`.
 */
export function canEditDocument(
  doc: ActionableDocument,
  actor: Pick<AuthUser, 'id' | 'permissions' | 'isSuperadmin'>,
  collaboratorRoles: readonly DocumentCollaboratorRole[],
): boolean {
  if (!isEditableStatus(doc.status)) return false;
  if (actor.isSuperadmin || doc.authorId === actor.id) return true;
  return collaboratorRoles.some((role) => DOCUMENT_EDITING_ROLES.includes(role));
}

/**
 * Everything this caller may do with the document, computed once by the server and sent to
 * the card (docs/modules/11 §12.5).
 *
 * A collaborator is deliberately NOT granted `manageAccess`, `manageCollaborators`,
 * `register` or `changeStatus`: a preparer drafts the text, but widening who can read a
 * ДСП document, minting its number or declaring it finished stay with the author, the
 * chancellery and the access holders (plan §6.2 — «collaborator никогда не обходит DSP
 * allow-list»).
 */
export function documentAvailableActions(
  doc: ActionableDocument,
  actor: Pick<AuthUser, 'id' | 'permissions' | 'isSuperadmin'>,
  collaboratorRoles: readonly DocumentCollaboratorRole[],
): DocumentAction[] {
  const actions: DocumentAction[] = [];
  const isAuthor = doc.authorId === actor.id;
  const isOwner = isAuthor || actor.isSuperadmin;

  if (canEditDocument(doc, actor, collaboratorRoles)) actions.push('edit');
  // Only the owner sends a document round: a preparer's job ends at the text.
  if (isOwner && doc.status === 'draft') actions.push('startRoute');
  // Registering is the chancellery's own act — control may SEE the registry but the
  // endpoint is guarded by docflow.register alone, so the looser predicate would render a
  // button that always 403s.
  if (
    hasChancelleryRights(actor) &&
    !doc.regNumber &&
    (doc.status === 'draft' || doc.status === 'pending_registration')
  ) {
    actions.push('register');
  }
  // The lifecycle is driven by the author or the chancellery/control (mirrors changeStatus).
  // Offered only while the status can actually move: a `completed` document is finished, and
  // its only next step is being filed into a case, which is the archive command's own button.
  if ((isOwner || hasRegistryAccess(actor)) && DOCUMENT_STATUS_TRANSITIONS[doc.status].length > 0) {
    actions.push('changeStatus');
  }
  if (canManageDocumentAccess(doc, actor)) actions.push('manageAccess');
  if (isOwner) actions.push('manageCollaborators');
  // Answering is offered on a registered incoming letter: an answer cites the number of the
  // letter it answers, so before registration there is nothing to cite (docs/modules/11 §12.3).
  if (
    (doc.docClass === 'incoming' || doc.docClass === 'citizens') &&
    !!doc.regNumber &&
    // Superadmin explicitly: their rights arrive as a wildcard, so a literal `includes`
    // would hide the action from the one account that may do everything.
    (actor.isSuperadmin || actor.permissions.includes('docflow.create'))
  ) {
    actions.push('createResponse');
  }
  // Recording a send is the chancellery's act, only once the letter has a number, and not
  // on an archived document — the same three facts assertDocumentDispatchable checks.
  if (
    doc.docClass === 'outgoing' &&
    !!doc.regNumber &&
    doc.status !== 'archived' &&
    hasChancelleryRights(actor)
  ) {
    actions.push('dispatch');
  }
  // Distributing an internal order is the author's own act — the chancellery may do it too,
  // but it is not a chancellery privilege (docs/modules/11 §12.4).
  if (
    doc.docClass === 'internal' &&
    !!doc.regNumber &&
    doc.status !== 'archived' &&
    (isOwner || hasRegistryAccess(actor))
  ) {
    actions.push('distribute');
  }
  // Filing away and taking back out are registry acts on a finished document. A legal hold
  // is offered to whoever holds the hold right — a separate one, because a hold is a legal
  // instruction rather than records housekeeping (docs/modules/11 §12.12).
  if (hasRegistryAccess(actor) && !doc.archivedAt && ARCHIVABLE_STATUSES.includes(doc.status)) {
    actions.push('archive');
  }
  if (hasRegistryAccess(actor) && !!doc.archivedAt && doc.dispositionStatus !== 'executed') {
    actions.push('restore');
  }
  if (actor.isSuperadmin || actor.permissions.includes('docflow.archive.hold')) {
    actions.push('legalHold');
  }
  return actions;
}
