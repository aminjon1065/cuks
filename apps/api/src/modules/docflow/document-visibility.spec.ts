import { describe, expect, it } from 'vitest';
import { canViewDocumentBase, hasConfidentialAccess } from './document-visibility';
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

describe('hasConfidentialAccess', () => {
  it('is true for superadmin or a docflow.confidential.view holder', () => {
    expect(hasConfidentialAccess(user({ isSuperadmin: true }))).toBe(true);
    expect(hasConfidentialAccess(user({ permissions: ['docflow.confidential.view'] }))).toBe(true);
    expect(hasConfidentialAccess(user({ permissions: ['docflow.register'] }))).toBe(false);
  });
});
