import { describe, expect, it, vi } from 'vitest';
import type { GeoJsonGeometry } from '@cuks/shared';
import { GisFeaturesService } from './gis-features.service';
import type { AuthUser } from '../../common/auth/auth-user';

const USER = {
  id: 'u1',
  username: 'gulomova.s',
  isSuperadmin: false,
  permissions: [],
} as unknown as AuthUser;

const POLYGON: GeoJsonGeometry = {
  type: 'Polygon',
  coordinates: [
    [
      [68.75, 38.53],
      [68.83, 38.53],
      [68.83, 38.59],
      [68.75, 38.53],
    ],
  ],
};
const POINT: GeoJsonGeometry = { type: 'Point', coordinates: [68.79, 38.56] };

function layers(geometryType: string | null) {
  return {
    requireLayer: vi.fn(async () => ({ id: 'l1', geometryType, kind: 'drawn' })),
    assertAccess: vi.fn(async () => undefined),
  };
}

/** A stored feature as `requireFeature` reads it back (geometry as GeoJSON text). */
function storedRow(geometry: GeoJsonGeometry = POLYGON) {
  return {
    id: 'f1',
    layerId: 'l1',
    geojson: JSON.stringify(geometry),
    props: { note: 'зона' },
    createdBy: 'u1',
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
  };
}

/** A db double whose `select` resolves to `rows` and whose writes record their calls.
 *  The chain covers both read shapes: the bbox list and the joined single read. */
function fakeDb(rows: unknown[]) {
  const update = { set: vi.fn(() => ({ where: vi.fn(async () => undefined) })) };
  const del = { where: vi.fn(async () => undefined) };
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'innerJoin', 'where', 'orderBy']) chain[method] = () => chain;
  chain['limit'] = async () => rows;
  return {
    db: {
      select: () => chain,
      insert: () => ({ values: () => ({ returning: async () => [{ id: 'f1' }] }) }),
      update: () => update,
      delete: () => del,
    },
    update,
    delete: del,
  };
}

describe('GisFeaturesService geometry rules', () => {
  it('accepts the layer geometry type and its Multi- variant', async () => {
    const audit = { log: vi.fn() };
    const { db } = fakeDb([storedRow()]);
    const service = new GisFeaturesService(db as never, layers('Polygon') as never, audit as never);

    await expect(
      service.create({ layerId: 'l1', geometry: POLYGON, props: {} }, USER),
    ).resolves.toMatchObject({ id: 'f1' });

    const multi: GeoJsonGeometry = { type: 'MultiPolygon', coordinates: [POLYGON.coordinates] };
    await expect(
      service.create({ layerId: 'l1', geometry: multi, props: {} }, USER),
    ).resolves.toMatchObject({ id: 'f1' });
  });

  it('rejects a geometry the layer does not accept', async () => {
    const { db } = fakeDb([storedRow()]);
    const service = new GisFeaturesService(
      db as never,
      layers('Polygon') as never,
      { log: vi.fn() } as never,
    );
    await expect(
      service.create({ layerId: 'l1', geometry: POINT, props: {} }, USER),
    ).rejects.toMatchObject({ code: 'gis.feature.geometry_mismatch' });
  });

  it('accepts anything on a mixed-geometry layer', async () => {
    const { db } = fakeDb([storedRow(POINT)]);
    const service = new GisFeaturesService(
      db as never,
      layers('Geometry') as never,
      { log: vi.fn() } as never,
    );
    await expect(
      service.create({ layerId: 'l1', geometry: POINT, props: {} }, USER),
    ).resolves.toMatchObject({ id: 'f1' });
  });
});

describe('GisFeaturesService write access', () => {
  it('requires `editor` on the layer for every write', async () => {
    const audit = { log: vi.fn() };
    const { db } = fakeDb([storedRow()]);
    const registry = layers('Polygon');
    const service = new GisFeaturesService(db as never, registry as never, audit as never);

    await service.create({ layerId: 'l1', geometry: POLYGON, props: {} }, USER);
    await service.patch('f1', { geometry: POLYGON }, USER);
    await service.remove('f1', USER);

    expect(registry.assertAccess).toHaveBeenCalledTimes(3);
    for (const call of registry.assertAccess.mock.calls) {
      expect((call as unknown as unknown[])[2]).toBe('editor');
    }
  });

  it('propagates the ACL denial instead of writing', async () => {
    const { db, update } = fakeDb([storedRow()]);
    const registry = layers('Polygon');
    registry.assertAccess = vi.fn(async () => {
      throw new Error('denied');
    });
    const service = new GisFeaturesService(
      db as never,
      registry as never,
      { log: vi.fn() } as never,
    );
    await expect(service.patch('f1', { geometry: POLYGON }, USER)).rejects.toThrow('denied');
    expect(update.set).not.toHaveBeenCalled();
  });
});

describe('GisFeaturesService audit trail', () => {
  it('keeps the previous geometry on an edit (docs/modules/10 §4: prev_geom in meta)', async () => {
    const audit = { log: vi.fn() };
    const { db } = fakeDb([storedRow()]);
    const service = new GisFeaturesService(db as never, layers('Polygon') as never, audit as never);

    const moved: GeoJsonGeometry = {
      type: 'Polygon',
      coordinates: [
        POLYGON.coordinates[0]!.map(([lon, lat]) => [lon! + 0.01, lat!] as [number, number]),
      ],
    };
    await service.patch('f1', { geometry: moved }, USER);

    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'gis.feature.updated',
        entityType: 'layer_feature',
        entityId: 'f1',
        meta: expect.objectContaining({ prevGeom: POLYGON, fields: ['geometry'] }),
      }),
    );
  });

  it('keeps the geometry of a deleted feature (a hard delete leaves no row)', async () => {
    const audit = { log: vi.fn() };
    const { db } = fakeDb([storedRow()]);
    const service = new GisFeaturesService(db as never, layers('Polygon') as never, audit as never);

    await service.remove('f1', USER);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'gis.feature.deleted',
        meta: expect.objectContaining({ prevGeom: POLYGON }),
      }),
    );
  });

  it('records a creation', async () => {
    const audit = { log: vi.fn() };
    const { db } = fakeDb([storedRow()]);
    const service = new GisFeaturesService(db as never, layers('Polygon') as never, audit as never);

    await service.create({ layerId: 'l1', geometry: POLYGON, props: {} }, USER);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'gis.feature.created',
        meta: expect.objectContaining({ layerId: 'l1', geometryType: 'Polygon' }),
      }),
    );
  });
});

describe('GisFeaturesService reads', () => {
  it('404s for a feature that does not exist', async () => {
    const { db } = fakeDb([]);
    const service = new GisFeaturesService(
      db as never,
      layers('Polygon') as never,
      { log: vi.fn() } as never,
    );
    await expect(service.getOne('missing')).rejects.toMatchObject({
      code: 'gis.feature.not_found',
    });
  });

  it('returns the geometry parsed back from PostGIS', async () => {
    const { db } = fakeDb([storedRow()]);
    const service = new GisFeaturesService(
      db as never,
      layers('Polygon') as never,
      { log: vi.fn() } as never,
    );
    await expect(service.getOne('f1')).resolves.toMatchObject({
      id: 'f1',
      layerId: 'l1',
      geometry: POLYGON,
      props: { note: 'зона' },
    });
  });
});
