import { describe, expect, it, vi } from 'vitest';
import { GisExportsService } from './gis-exports.service';
import type { AuthUser } from '../../common/auth/auth-user';

const USER = { id: 'u1', username: 'gulomova.s', isSuperadmin: false } as unknown as AuthUser;

function exportRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e1',
    source: 'layer',
    format: 'geojson',
    params: { layerId: 'l1' },
    status: 'pending',
    storageKey: null,
    fileName: null,
    sizeBytes: null,
    featureCount: null,
    error: null,
    createdBy: 'u1',
    createdAt: new Date('2026-07-15T00:00:00Z'),
    finishedAt: null,
    ...overrides,
  };
}

function fakeDb(rows: unknown[]) {
  const chain: Record<string, unknown> = {};
  for (const method of ['from', 'where', 'orderBy']) chain[method] = () => chain;
  chain['limit'] = async () => rows;
  return {
    select: () => chain,
    insert: () => ({ values: () => ({ returning: async () => rows }) }),
  };
}

const audit = { log: vi.fn() } as never;

describe('GisExportsService.create', () => {
  it('checks the layer exists before queueing — the worker would fail async', async () => {
    const layers = {
      requireLayer: vi.fn(async () => {
        throw Object.assign(new Error('not found'), { code: 'gis.layer.not_found' });
      }),
    };
    const queue = { add: vi.fn() };
    const service = new GisExportsService(
      fakeDb([exportRow()]) as never,
      {} as never,
      layers as never,
      audit,
      queue as never,
    );
    await expect(
      service.create({ source: 'layer', format: 'gpkg', layerId: 'gone' }, USER),
    ).rejects.toMatchObject({ code: 'gis.layer.not_found' });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('records a layer export and queues it once', async () => {
    const queue = { add: vi.fn() };
    const service = new GisExportsService(
      fakeDb([exportRow()]) as never,
      {} as never,
      { requireLayer: vi.fn(async () => ({ id: 'l1' })) } as never,
      audit,
      queue as never,
    );
    const created = await service.create(
      { source: 'layer', format: 'geojson', layerId: 'l1' },
      USER,
    );
    expect(created).toMatchObject({ id: 'e1', status: 'pending', format: 'geojson' });
    expect(queue.add).toHaveBeenCalledWith(
      'export',
      { exportId: 'e1' },
      expect.objectContaining({ attempts: 1 }),
    );
  });

  it('records an incident export with the registry filters', async () => {
    const queue = { add: vi.fn() };
    const service = new GisExportsService(
      fakeDb([exportRow({ source: 'incidents', params: { filters: { severity: 3 } } })]) as never,
      {} as never,
      { requireLayer: vi.fn() } as never,
      audit,
      queue as never,
    );
    const created = await service.create(
      { source: 'incidents', format: 'xlsx', filters: { severity: 3 } },
      USER,
    );
    expect(created.source).toBe('incidents');
    expect(queue.add).toHaveBeenCalled();
  });
});

describe('GisExportsService.downloadUrl', () => {
  it('refuses to sign a download before the worker has written the file', async () => {
    const service = new GisExportsService(
      fakeDb([exportRow({ status: 'processing' })]) as never,
      { getDownloadUrl: vi.fn() } as never,
      {} as never,
      audit,
      { add: vi.fn() } as never,
    );
    await expect(service.downloadUrl('e1', USER)).rejects.toMatchObject({
      code: 'gis.export.not_ready',
    });
  });

  it('signs a short-lived download for a finished export', async () => {
    const storage = { getDownloadUrl: vi.fn(async () => 'https://minio/get') };
    const service = new GisExportsService(
      fakeDb([
        exportRow({
          status: 'done',
          storageKey: 'gis-exports/e1/roads.gpkg',
          fileName: 'Дороги.gpkg',
        }),
      ]) as never,
      storage as never,
      {} as never,
      audit,
      { add: vi.fn() } as never,
    );
    await expect(service.downloadUrl('e1', USER)).resolves.toBe('https://minio/get');
    expect(storage.getDownloadUrl).toHaveBeenCalledWith('gis-exports/e1/roads.gpkg', 'Дороги.gpkg');
  });

  it('404s for an export that is not the caller’s', async () => {
    const service = new GisExportsService(fakeDb([]) as never, {} as never, {} as never, audit, {
      add: vi.fn(),
    } as never);
    await expect(service.getOne('e1', USER)).rejects.toMatchObject({
      code: 'gis.export.not_found',
    });
  });
});
