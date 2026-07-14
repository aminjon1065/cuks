import { describe, expect, it, vi } from 'vitest';
import { GIS_IMPORT_MAX_BYTES } from '@cuks/shared';
import { GisImportsService } from './gis-imports.service';
import type { AuthUser } from '../../common/auth/auth-user';

const USER = { id: 'u1', username: 'gulomova.s', isSuperadmin: false } as unknown as AuthUser;

function importRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'i1',
    status: 'pending',
    storageKey: 'gis-imports/i1/roads.zip',
    sourceName: 'roads.zip',
    sizeBytes: 1024,
    layerId: null,
    preview: null,
    log: null,
    options: {},
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
  const where = vi.fn(() => ({ returning: async () => rows }));
  // `update().set().where()` is awaited in one place and `.returning()`-ed in
  // another, so the double must be usable both ways.
  const whereThenable = Object.assign(where, { then: undefined });
  const set = vi.fn(() => ({
    where: (...args: unknown[]) =>
      Object.assign(Promise.resolve(undefined), whereThenable(...(args as []))),
  }));
  return {
    select: () => chain,
    insert: () => ({ values: () => ({ returning: async () => rows }) }),
    update: () => ({ set }),
  };
}

const audit = { log: vi.fn() } as never;

describe('GisImportsService.create', () => {
  it('refuses a format the worker cannot read', async () => {
    const service = new GisImportsService(fakeDb([importRow()]) as never, {} as never, audit, {
      add: vi.fn(),
    } as never);
    await expect(service.create({ fileName: 'roads.dwg', size: 100 }, USER)).rejects.toMatchObject({
      code: 'gis.import.unsupported_format',
    });
  });

  it('reserves the record and hands back a presigned upload URL', async () => {
    const storage = { getUploadUrl: vi.fn(async () => 'https://minio/put') };
    const service = new GisImportsService(fakeDb([importRow()]) as never, storage as never, audit, {
      add: vi.fn(),
    } as never);
    const result = await service.create({ fileName: 'roads.zip', size: 2048 }, USER);
    expect(result).toEqual({ importId: 'i1', uploadUrl: 'https://minio/put' });
    // The key is namespaced by the record, so an abandoned upload is easy to find.
    expect(storage.getUploadUrl).toHaveBeenCalledWith(
      'gis-imports/i1/roads.zip',
      'application/octet-stream',
    );
  });
});

describe('GisImportsService.start', () => {
  it('queues the job only once the object is actually in storage', async () => {
    const queue = { add: vi.fn() };
    const storage = { objectSize: vi.fn(async () => null) };
    const service = new GisImportsService(
      fakeDb([importRow()]) as never,
      storage as never,
      audit,
      queue as never,
    );
    await expect(service.start('i1', USER)).rejects.toMatchObject({
      code: 'gis.import.not_uploaded',
    });
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('rejects an object larger than the cap, whatever size was declared', async () => {
    const service = new GisImportsService(
      fakeDb([importRow()]) as never,
      { objectSize: async () => GIS_IMPORT_MAX_BYTES + 1 } as never,
      audit,
      { add: vi.fn() } as never,
    );
    await expect(service.start('i1', USER)).rejects.toMatchObject({
      code: 'gis.import.too_large',
    });
  });

  it('queues the worker for an uploaded source', async () => {
    const queue = { add: vi.fn() };
    const service = new GisImportsService(
      fakeDb([importRow()]) as never,
      { objectSize: async () => 4096 } as never,
      audit,
      queue as never,
    );
    await service.start('i1', USER);
    expect(queue.add).toHaveBeenCalledWith(
      'import',
      { importId: 'i1' },
      expect.objectContaining({ attempts: 1 }),
    );
  });

  it('will not queue the same import twice', async () => {
    const queue = { add: vi.fn() };
    const service = new GisImportsService(
      fakeDb([importRow({ status: 'processing' })]) as never,
      { objectSize: async () => 4096 } as never,
      audit,
      queue as never,
    );
    await expect(service.start('i1', USER)).rejects.toMatchObject({
      code: 'gis.import.already_started',
    });
    expect(queue.add).not.toHaveBeenCalled();
  });
});

describe('GisImportsService.getOne', () => {
  it('404s for an import that is not the caller’s', async () => {
    const service = new GisImportsService(fakeDb([]) as never, {} as never, audit, {
      add: vi.fn(),
    } as never);
    await expect(service.getOne('i1', USER)).rejects.toMatchObject({
      code: 'gis.import.not_found',
    });
  });
});
