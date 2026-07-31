import { and, eq, isNull } from 'drizzle-orm';
import { documentCollaborators, type Database } from '@cuks/db';
import {
  DOCUMENT_EDITING_ROLES,
  type DocumentAction,
  type DocClass,
  type DocumentCollaboratorRole,
  type DocumentStatus,
} from '@cuks/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { canManageDocumentAccess, hasRegistryAccess } from './document-visibility';

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
}

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
  if (
    hasRegistryAccess(actor) &&
    !doc.regNumber &&
    (doc.status === 'draft' || doc.status === 'pending_registration')
  ) {
    actions.push('register');
  }
  // The lifecycle is driven by the author or the chancellery/control (mirrors changeStatus).
  if (isOwner || hasRegistryAccess(actor)) actions.push('changeStatus');
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
  // Recording a send is the chancellery's act, and only once the letter has a number.
  if (doc.docClass === 'outgoing' && !!doc.regNumber && hasRegistryAccess(actor)) {
    actions.push('dispatch');
  }
  return actions;
}
