import { describe, expect, it } from 'vitest';
import { abilityFromRules, buildAbility, hasPermission, serializeAbility } from './index';

describe('ability', () => {
  it('grants only the listed permissions to a regular user', () => {
    const ability = buildAbility({
      permissions: ['docflow.use', 'files.use'],
      isSuperadmin: false,
    });
    expect(hasPermission(ability, 'docflow.use')).toBe(true);
    expect(hasPermission(ability, 'files.use')).toBe(true);
    expect(hasPermission(ability, 'docflow.sign')).toBe(false);
    expect(hasPermission(ability, 'admin.users.manage')).toBe(false);
  });

  it('grants everything to a superadmin', () => {
    const ability = buildAbility({ permissions: [], isSuperadmin: true });
    expect(hasPermission(ability, 'admin.users.manage')).toBe(true);
    expect(hasPermission(ability, 'anything.at.all')).toBe(true);
  });

  it('treats the wildcard permission as superadmin', () => {
    const ability = buildAbility({ permissions: ['*'], isSuperadmin: false });
    expect(hasPermission(ability, 'gis.pg.access')).toBe(true);
  });

  it('serializes and rebuilds an equivalent ability (frontend round-trip)', () => {
    const original = buildAbility({ permissions: ['tasks.use'], isSuperadmin: false });
    const rebuilt = abilityFromRules(serializeAbility(original));
    expect(hasPermission(rebuilt, 'tasks.use')).toBe(true);
    expect(hasPermission(rebuilt, 'tasks.projects.create')).toBe(false);
  });
});
