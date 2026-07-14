import { describe, expect, it, vi } from 'vitest';
import { GisLayersService, slugify } from './gis-layers.service';
import type { AuthUser } from '../../common/auth/auth-user';

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'u1',
    username: 'gulomova.s',
    isSuperadmin: false,
    permissions: [],
    ...overrides,
  } as unknown as AuthUser;
}

/** The drawn layer row as the DB returns it. */
function layerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'l1',
    slug: 'oceplenie',
    title: 'Оцепление',
    kind: 'drawn',
    geometryType: 'Polygon',
    style: { color: '#b91c1c' },
    description: null,
    minZoom: null,
    maxZoom: null,
    createdBy: 'u1',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

const audit = { log: vi.fn() } as never;
// GeoServer is not exercised by these tests (they cover ACL + slug), so a stub that
// reports 'not configured' is enough.
const geoserver = { configured: false, unpublish: vi.fn() } as never;

describe('slugify', () => {
  it('transliterates a Russian title into an ASCII slug', () => {
    expect(slugify('Оцепление — тест')).toBe('oceplenie-test');
  });

  it('transliterates the Tajik-specific letters instead of dropping them', () => {
    expect(slugify('Ҳудуди хатар')).toBe('hududi-hatar');
    expect(slugify('Ҷӯйбор ғарқ қишлоқ')).toBe('chuibor-gharq-qishloq');
  });

  it('never returns an empty slug (the column is unique and NOT NULL)', () => {
    expect(slugify('!!! ???')).toBe('layer');
    expect(slugify('中文')).toBe('layer');
  });

  it('caps the length so the slug stays addressable', () => {
    expect(slugify('a'.repeat(80))).toHaveLength(48);
  });
});

describe('GisLayersService.assertAccess', () => {
  const acl = { check: vi.fn() };
  const service = new GisLayersService({} as never, acl as never, audit, geoserver);

  it('refuses to edit a system layer through the drawn-layer surface', async () => {
    await expect(
      service.assertAccess(layerRow({ kind: 'system' }) as never, user(), 'editor'),
    ).rejects.toMatchObject({ code: 'gis.layer.not_editable' });
  });

  it('lets a superadmin and a gis.layers.manage holder past the per-layer ACL', async () => {
    acl.check.mockClear();
    await service.assertAccess(layerRow() as never, user({ isSuperadmin: true }), 'manager');
    await service.assertAccess(
      layerRow() as never,
      user({ permissions: ['gis.layers.manage'] }),
      'manager',
    );
    expect(acl.check).not.toHaveBeenCalled();
  });

  it('falls back to the per-layer ACL and denies without it', async () => {
    acl.check.mockResolvedValueOnce(true);
    await expect(
      service.assertAccess(layerRow() as never, user(), 'editor'),
    ).resolves.toBeUndefined();
    expect(acl.check).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'u1' }),
      'layer',
      'l1',
      'editor',
    );

    acl.check.mockResolvedValueOnce(false);
    await expect(service.assertAccess(layerRow() as never, user(), 'editor')).rejects.toMatchObject(
      { code: 'gis.layer.access_denied' },
    );
  });
});

describe('GisLayersService.requireLayer', () => {
  it('404s for a soft-deleted layer', async () => {
    const db = {
      select: () => ({
        from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
      }),
    };
    const service = new GisLayersService(
      db as never,
      { check: vi.fn() } as never,
      audit,
      geoserver,
    );
    await expect(service.requireLayer('gone')).rejects.toMatchObject({
      code: 'gis.layer.not_found',
    });
  });
});

describe('GisLayersService.assertManage (task 2.8)', () => {
  const acl = { check: vi.fn() };
  const service = new GisLayersService({} as never, acl as never, audit, geoserver);

  it('lets the manager of an imported layer delete it — a wrong import must be removable', async () => {
    acl.check.mockResolvedValueOnce(true);
    await expect(
      service.assertManage(layerRow({ kind: 'imported', tableName: 'l_roads' }) as never, user()),
    ).resolves.toBeUndefined();
  });

  it('still refuses to edit the *objects* of an imported layer (it is a file snapshot)', async () => {
    await expect(
      service.assertAccess(layerRow({ kind: 'imported' }) as never, user(), 'editor'),
    ).rejects.toMatchObject({ code: 'gis.layer.not_editable' });
  });

  it('never lets a system layer be changed through this surface', async () => {
    await expect(
      service.assertManage(layerRow({ kind: 'system' }) as never, user({ isSuperadmin: true })),
    ).rejects.toMatchObject({ code: 'gis.layer.not_editable' });
  });
});
