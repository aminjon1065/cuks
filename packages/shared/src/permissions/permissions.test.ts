import { describe, expect, it } from 'vitest';
import { PERMISSIONS, PERMISSION_WILDCARD, ROLE_TEMPLATES } from './index';

describe('permission catalog', () => {
  const known = new Set<string>([...PERMISSIONS, PERMISSION_WILDCARD]);

  it('every role-template permission exists in the catalog', () => {
    for (const role of ROLE_TEMPLATES) {
      for (const permission of role.permissions) {
        expect(
          known,
          `role "${role.code}" references unknown permission "${permission}"`,
        ).toContain(permission);
      }
    }
  });

  it('role codes are unique', () => {
    const codes = ROLE_TEMPLATES.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('only the superadmin holds the wildcard', () => {
    const wildcardRoles = ROLE_TEMPLATES.filter((r) =>
      r.permissions.includes(PERMISSION_WILDCARD),
    ).map((r) => r.code);
    expect(wildcardRoles).toEqual(['superadmin']);
  });

  it('has no duplicate permission strings in the catalog', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });
});
