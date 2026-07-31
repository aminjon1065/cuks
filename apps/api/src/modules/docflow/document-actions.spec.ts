import { describe, expect, it } from 'vitest';
import type { DocumentCollaboratorRole, DocumentStatus } from '@cuks/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import {
  canEditDocument,
  documentAvailableActions,
  isEditableStatus,
  type ActionableDocument,
} from './document-actions';

const AUTHOR = 'u-author';
const OTHER = 'u-other';

function doc(over: Partial<ActionableDocument> = {}): ActionableDocument {
  return {
    authorId: AUTHOR,
    docClass: 'internal',
    status: 'draft',
    confidentiality: 'normal',
    accessList: [],
    regNumber: null,
    ...over,
  };
}

function user(
  id: string,
  over: Partial<Pick<AuthUser, 'permissions' | 'isSuperadmin'>> = {},
): Pick<AuthUser, 'id' | 'permissions' | 'isSuperadmin'> {
  return { id, permissions: [], isSuperadmin: false, ...over };
}

const clerk = (id = OTHER) => user(id, { permissions: ['docflow.register'] });
const noRoles: DocumentCollaboratorRole[] = [];

describe('isEditableStatus', () => {
  it('covers the draft and the rework state, nothing past registration', () => {
    expect(isEditableStatus('draft')).toBe(true);
    // A rejection asks for rework, so the author must be able to fix the document.
    expect(isEditableStatus('rejected')).toBe(true);
    for (const status of [
      'on_route',
      'pending_registration',
      'registered',
      'in_progress',
      'completed',
      'archived',
      'recalled',
    ] as DocumentStatus[]) {
      expect(isEditableStatus(status), status).toBe(false);
    }
  });
});

describe('canEditDocument', () => {
  it('lets the author edit an editable draft', () => {
    expect(canEditDocument(doc(), user(AUTHOR), noRoles)).toBe(true);
    expect(canEditDocument(doc({ status: 'rejected' }), user(AUTHOR), noRoles)).toBe(true);
  });

  it('stops even the author once the document is past editing', () => {
    // After registration the card is a record; a correction is a separate audited action.
    expect(canEditDocument(doc({ status: 'registered' }), user(AUTHOR), noRoles)).toBe(false);
    expect(canEditDocument(doc({ status: 'on_route' }), user(AUTHOR), noRoles)).toBe(false);
  });

  it('lets a preparer or editor collaborator edit — that is the point of the role', () => {
    expect(canEditDocument(doc(), user(OTHER), ['preparer'])).toBe(true);
    expect(canEditDocument(doc(), user(OTHER), ['editor'])).toBe(true);
  });

  it('does not let a viewer collaborator edit', () => {
    expect(canEditDocument(doc(), user(OTHER), ['viewer'])).toBe(false);
  });

  it('does not let the chancellery rewrite somebody else’s draft', () => {
    // Registry access is for finding and registering documents, not for editing them.
    expect(canEditDocument(doc(), clerk(), noRoles)).toBe(false);
  });

  it('still respects the status for a collaborator', () => {
    expect(canEditDocument(doc({ status: 'registered' }), user(OTHER), ['preparer'])).toBe(false);
  });
});

describe('documentAvailableActions', () => {
  it('gives the author the full owner set on a draft', () => {
    expect(documentAvailableActions(doc(), user(AUTHOR), noRoles)).toEqual([
      'edit',
      'startRoute',
      'changeStatus',
      'manageAccess',
      'manageCollaborators',
    ]);
  });

  it('gives a preparer edit and nothing else', () => {
    // A preparer drafts the text; widening ДСП access, minting the number and declaring
    // the document finished stay with the author and the chancellery (plan §6.2).
    expect(documentAvailableActions(doc(), user(OTHER), ['preparer'])).toEqual(['edit']);
  });

  it('gives a viewer collaborator nothing at all', () => {
    expect(documentAvailableActions(doc(), user(OTHER), ['viewer'])).toEqual([]);
  });

  it('offers the chancellery registration while the number is still unminted', () => {
    expect(documentAvailableActions(doc(), clerk(), noRoles)).toContain('register');
    expect(
      documentAvailableActions(doc({ status: 'pending_registration' }), clerk(), noRoles),
    ).toContain('register');
  });

  it('never offers a second registration once a number exists', () => {
    const registered = doc({ status: 'registered', regNumber: 'П-2026/0001' });
    expect(documentAvailableActions(registered, clerk(), noRoles)).not.toContain('register');
  });

  it('keeps collaborator management with the owner', () => {
    expect(documentAvailableActions(doc(), user(OTHER), ['editor'])).not.toContain(
      'manageCollaborators',
    );
    expect(documentAvailableActions(doc(), clerk(), noRoles)).not.toContain('manageCollaborators');
    expect(documentAvailableActions(doc(), user(AUTHOR), noRoles)).toContain('manageCollaborators');
  });

  it('never grants a collaborator access management on a ДСП document', () => {
    // The допуск-список is the only gate on ДСП; a preparer must not be able to widen it.
    const dsp = doc({ confidentiality: 'dsp', accessList: [OTHER] });
    expect(documentAvailableActions(dsp, user(OTHER), ['preparer'])).not.toContain('manageAccess');
  });

  it('gives a superadmin the owner set on any document', () => {
    const actions = documentAvailableActions(doc(), user(OTHER, { isSuperadmin: true }), noRoles);
    expect(actions).toContain('edit');
    expect(actions).toContain('manageCollaborators');
  });
});

describe('documentAvailableActions — the outgoing half (plan этап 6)', () => {
  const clerk = {
    id: OTHER,
    permissions: ['docflow.use', 'docflow.create', 'docflow.register'],
    isSuperadmin: false,
  };

  it('offers «создать ответ» only on a REGISTERED incoming letter', () => {
    const registered = doc({ docClass: 'incoming', status: 'registered', regNumber: 'ВХ-1' });
    expect(documentAvailableActions(registered, clerk, [])).toContain('createResponse');

    // An unnumbered letter has nothing for the answer to cite.
    const draft = doc({ docClass: 'incoming', status: 'draft', regNumber: null });
    expect(documentAvailableActions(draft, clerk, [])).not.toContain('createResponse');

    // And an outgoing document is not something one answers.
    const outgoing = doc({ docClass: 'outgoing', status: 'registered', regNumber: 'ИСХ-1' });
    expect(documentAvailableActions(outgoing, clerk, [])).not.toContain('createResponse');
  });

  it('needs `docflow.create` to answer', () => {
    const reader = { id: OTHER, permissions: ['docflow.use'], isSuperadmin: false };
    const registered = doc({ docClass: 'incoming', status: 'registered', regNumber: 'ВХ-1' });
    expect(documentAvailableActions(registered, reader, [])).not.toContain('createResponse');
  });

  it('offers the send only on a numbered outgoing document, and only to the chancellery', () => {
    const outgoing = doc({ docClass: 'outgoing', status: 'registered', regNumber: 'ИСХ-1' });
    expect(documentAvailableActions(outgoing, clerk, [])).toContain('dispatch');

    const author = {
      id: AUTHOR,
      permissions: ['docflow.use', 'docflow.create'],
      isSuperadmin: false,
    };
    expect(documentAvailableActions(outgoing, author, [])).not.toContain('dispatch');

    const unnumbered = doc({ docClass: 'outgoing', status: 'draft', regNumber: null });
    expect(documentAvailableActions(unnumbered, clerk, [])).not.toContain('dispatch');

    const internal = doc({ docClass: 'internal', status: 'registered', regNumber: 'П-1' });
    expect(documentAvailableActions(internal, clerk, [])).not.toContain('dispatch');
  });
});
