import { describe, expect, it, vi } from 'vitest';
import { UploadsService } from './uploads.service';

function selectChain(result: unknown[]) {
  const obj: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'orderBy', 'limit']) obj[m] = () => obj;
  obj['then'] = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej);
  return obj;
}

const user = { id: 'u1', isSuperadmin: false } as never;

describe('UploadsService.initiate', () => {
  it('rejects when the target parent quota would be exceeded, without calling storage', async () => {
    const nodes = {
      resolveTarget: vi
        .fn()
        .mockResolvedValue({ parent: null, ownerUserId: 'u1', ownerOrgUnitId: null }),
      assertAccess: vi.fn(),
      assertNoSibling: vi.fn(),
      assertQuota: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('quota'), { code: 'files.quota.exceeded' })),
    };
    const storage = { initiateUpload: vi.fn() };
    const db = { select: vi.fn(), insert: vi.fn() };
    const service = new UploadsService(
      db as never,
      nodes as never,
      storage as never,
      { log: vi.fn() } as never,
    );

    await expect(
      service.initiate(
        {
          space: 'personal',
          name: 'big.bin',
          size: 3_000_000_000,
          mime: 'application/octet-stream',
        },
        user,
      ),
    ).rejects.toMatchObject({ code: 'files.quota.exceeded' });
    expect(storage.initiateUpload).not.toHaveBeenCalled();
  });
});

describe('UploadsService staging ownership', () => {
  it('refuses to complete an upload session created by someone else', async () => {
    const nodes = {};
    const storage = {};
    const db = {
      select: vi.fn(() =>
        selectChain([
          { id: 'up1', createdBy: 'someone-else', storageKey: 'k', s3UploadId: 's3-1' },
        ]),
      ),
    };
    const service = new UploadsService(
      db as never,
      nodes as never,
      storage as never,
      { log: vi.fn() } as never,
    );

    await expect(
      service.complete(
        'up1',
        { parts: [{ partNumber: 1, eTag: '"a"' }], checksumSha256: 'a'.repeat(64) },
        user,
      ),
    ).rejects.toMatchObject({ code: 'files.upload.forbidden' });
  });

  it('404s completing an upload session that does not exist', async () => {
    const db = { select: vi.fn(() => selectChain([])) };
    const service = new UploadsService(
      db as never,
      {} as never,
      {} as never,
      { log: vi.fn() } as never,
    );
    await expect(service.abort('missing', user)).rejects.toMatchObject({
      code: 'files.upload.not_found',
    });
  });
});
