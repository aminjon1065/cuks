import { describe, expect, it } from 'vitest';
import {
  canManageDocumentAccess,
  canViewDocumentBase,
  hasConfidentialAccess,
} from './document-visibility';
import type { AuthUser } from '../../common/auth/auth-user';

type VisDoc = Parameters<typeof canViewDocumentBase>[0];
type VisUser = Parameters<typeof canViewDocumentBase>[1];

const user = (over: Partial<AuthUser>): VisUser =>
  ({ id: 'u1', permissions: [], isSuperadmin: false, ...over }) as AuthUser;

const doc = (over: Partial<VisDoc>): VisDoc => ({
  authorId: 'author',
  accessList: [],
  confidentiality: 'normal',
  ...over,
});

describe('canViewDocumentBase — ДСП rule (docs/09 §3)', () => {
  it('lets the author and superadmin see a ДСП document unconditionally', () => {
    const d = doc({ confidentiality: 'dsp' });
    expect(canViewDocumentBase({ ...d, authorId: 'u1' }, user({}))).toBe(true);
    expect(canViewDocumentBase(d, user({ isSuperadmin: true }))).toBe(true);
  });

  it('requires BOTH access-list membership AND docflow.confidential.view for ДСП', () => {
    const d = doc({ confidentiality: 'dsp', accessList: ['u1'] });
    // on the list + the право → visible
    expect(canViewDocumentBase(d, user({ permissions: ['docflow.confidential.view'] }))).toBe(true);
    // on the list but no право → hidden
    expect(canViewDocumentBase(d, user({ permissions: [] }))).toBe(false);
    // the право but not on the list → hidden
    expect(
      canViewDocumentBase(
        doc({ confidentiality: 'dsp', accessList: ['other'] }),
        user({ permissions: ['docflow.confidential.view'] }),
      ),
    ).toBe(false);
  });

  it('never yields ДСП to registry access alone (docs/modules/11 §2 line 85)', () => {
    const d = doc({ confidentiality: 'dsp' });
    expect(canViewDocumentBase(d, user({ permissions: ['docflow.register'] }))).toBe(false);
    expect(canViewDocumentBase(d, user({ permissions: ['docflow.control'] }))).toBe(false);
  });

  it('leaves the non-ДСП rule intact (access list or registry)', () => {
    expect(canViewDocumentBase(doc({ accessList: ['u1'] }), user({}))).toBe(true);
    expect(canViewDocumentBase(doc({}), user({ permissions: ['docflow.register'] }))).toBe(true);
    expect(canViewDocumentBase(doc({}), user({}))).toBe(false); // unrelated user
  });
});

describe('canManageDocumentAccess — grif / access-list management (docs/09 §3)', () => {
  it('lets the author and superadmin manage', () => {
    const d = doc({ confidentiality: 'dsp' });
    expect(canManageDocumentAccess({ ...d, authorId: 'u1' }, user({}))).toBe(true);
    expect(canManageDocumentAccess(d, user({ isSuperadmin: true }))).toBe(true);
  });

  it('does NOT let a confidential.view holder manage a ДСП document they are not on the list of', () => {
    // The core fix: право alone must not grant access-list management (else it self-grants view).
    const d = doc({ confidentiality: 'dsp', accessList: ['other'] });
    expect(canManageDocumentAccess(d, user({ permissions: ['docflow.confidential.view'] }))).toBe(
      false,
    );
  });

  it('lets a listed confidential.view holder manage a ДСП document', () => {
    const d = doc({ confidentiality: 'dsp', accessList: ['u1'] });
    expect(canManageDocumentAccess(d, user({ permissions: ['docflow.confidential.view'] }))).toBe(
      true,
    );
  });

  it('lets the chancellery (registry + confidential.view) classify a normal document it can see', () => {
    const d = doc({ confidentiality: 'normal' });
    expect(
      canManageDocumentAccess(
        d,
        user({ permissions: ['docflow.register', 'docflow.confidential.view'] }),
      ),
    ).toBe(true);
    // registry access WITHOUT the confidential право cannot classify
    expect(canManageDocumentAccess(d, user({ permissions: ['docflow.register'] }))).toBe(false);
  });
});

describe('hasConfidentialAccess', () => {
  it('is true for superadmin or a docflow.confidential.view holder', () => {
    expect(hasConfidentialAccess(user({ isSuperadmin: true }))).toBe(true);
    expect(hasConfidentialAccess(user({ permissions: ['docflow.confidential.view'] }))).toBe(true);
    expect(hasConfidentialAccess(user({ permissions: ['docflow.register'] }))).toBe(false);
  });
});
