import { describe, expect, it } from 'vitest';
import { PERMISSIONS, PERMISSION_WILDCARD, ROLE_TEMPLATES } from './index';

/**
 * Permissions no seeded role holds, deliberately: each widens ONE capability inside a module
 * whose ordinary users do not need it, and the administrator grants it by building a custom role
 * (docs/05 §5 — templates are a starting point, not a closed set).
 *
 * - `files.org.manage` — sharing into an org-unit subtree (file-sharing.service.ts:357).
 * - `chat.admin` — administering channels the holder does not own.
 * - `meet.recordings.manage` — managing other people's recordings (recordings.service.ts:305).
 *
 * Listed here rather than ignored, so the assertion above still fails on a NEW orphan. That is
 * exactly how `docflow.journals.manage` was found: it gated the whole «Настройки ДОУ» screen,
 * which docs/modules/11-docflow.md §7 assigns to the chancellery, and no role had it — the menu
 * item simply was not there for anyone but the wildcard superadmin.
 */
const KNOWN_UNASSIGNED = ['files.org.manage', 'chat.admin', 'meet.recordings.manage'];

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

  it('every catalogued permission is reachable through some role template', () => {
    // The reverse of the check above, and the one that was missing. `docflow.journals.manage`
    // existed in the catalog, was required by every write on the «Настройки ДОУ» screen, and was
    // held by NO role template — so on a fresh installation nobody but the wildcard superadmin
    // could open a journal for the new year. Nothing failed; the menu item simply was not there.
    const granted = new Set(ROLE_TEMPLATES.flatMap((r) => r.permissions));
    if (granted.has(PERMISSION_WILDCARD)) {
      // The wildcard grants everything, and would make this assertion vacuous. Check the
      // explicitly-listed roles instead — those are the ones a real installation uses.
      granted.delete(PERMISSION_WILDCARD);
    }
    const orphaned = PERMISSIONS.filter((p) => !granted.has(p));
    expect(orphaned, 'permissions no role template grants — the screen has no audience').toEqual(
      KNOWN_UNASSIGNED,
    );
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
