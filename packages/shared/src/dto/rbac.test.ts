import { describe, expect, it } from 'vitest';
import { aclLevelSatisfies } from '../enums/index';
import { PERMISSIONS, permissionCatalog, permissionModule } from '../permissions/index';
import { createRoleSchema } from './rbac';

describe('rbac helpers', () => {
  it('maps permissions to modules (incidents -> gis)', () => {
    expect(permissionModule('admin.users.manage')).toBe('admin');
    expect(permissionModule('incidents.create')).toBe('gis');
    expect(permissionModule('gis.view')).toBe('gis');
    expect(permissionModule('docflow.sign')).toBe('docflow');
  });

  it('catalog covers every permission exactly once', () => {
    const catalog = permissionCatalog();
    expect(catalog).toHaveLength(PERMISSIONS.length);
    expect(new Set(catalog.map((c) => c.code)).size).toBe(PERMISSIONS.length);
  });

  it('orders ACL levels viewer < editor < manager', () => {
    expect(aclLevelSatisfies('manager', 'viewer')).toBe(true);
    expect(aclLevelSatisfies('editor', 'editor')).toBe(true);
    expect(aclLevelSatisfies('viewer', 'editor')).toBe(false);
  });
});

describe('createRoleSchema', () => {
  it('accepts a valid role with catalog permissions', () => {
    const parsed = createRoleSchema.parse({
      code: 'regional_lead',
      name: 'Региональный руководитель',
      permissions: ['gis.view', 'analytics.view'],
    });
    expect(parsed.permissions).toEqual(['gis.view', 'analytics.view']);
  });

  it('rejects an unknown permission', () => {
    expect(() =>
      createRoleSchema.parse({ code: 'x_role', name: 'X', permissions: ['does.not.exist'] }),
    ).toThrow();
  });

  it('rejects an invalid role code', () => {
    expect(() =>
      createRoleSchema.parse({ code: 'Bad Code', name: 'X', permissions: [] }),
    ).toThrow();
  });

  it('defaults permissions to an empty array', () => {
    expect(createRoleSchema.parse({ code: 'empty_role', name: 'Empty' }).permissions).toEqual([]);
  });
});
