import { describe, expect, it, vi } from 'vitest';
import { FileVersionsService } from './file-versions.service';

function selectChain(result: unknown[]) {
  const obj: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'orderBy', 'limit', 'for']) obj[m] = () => obj;
  obj['then'] = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
    Promise.resolve(result).then(res, rej);
  return obj;
}

const oldVersionRow = {
  id: 'old-ver',
  nodeId: 'n1',
  version: 1,
  storageKey: 'k1',
  size: 1000,
  mime: 'image/png',
  checksumSha256: 'a'.repeat(64),
  uploadedBy: 'u1',
  avStatus: 'clean',
  extractedText: 'old text',
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const nodeRow = {
  id: 'n1',
  parentId: null,
  kind: 'file' as const,
  name: 'doc.png',
  space: 'personal' as const,
  ownerUserId: 'u1',
  ownerOrgUnitId: null,
  currentVersionId: 'new-ver',
  sizeCached: 1000,
  mime: 'image/png',
  tags: [],
  starredBy: [],
  path: 'n1',
  searchTsv: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
  createdBy: 'u1',
};

const user = { id: 'u1', isSuperadmin: false } as never;

function makeService() {
  const nodes = {
    requireNode: vi.fn().mockResolvedValue(nodeRow),
    assertAccess: vi.fn().mockResolvedValue(undefined),
    toDto: vi.fn((n: unknown, avStatus: unknown) => ({ id: (n as { id: string }).id, avStatus })),
  };
  const audit = { log: vi.fn() };
  const avScanQueue = { add: vi.fn().mockResolvedValue(undefined) };

  let capturedInsertValues: unknown;
  const txSelect = vi.fn(() => {
    // 1st call: row lock (result unused); 2nd call: max(version).
    return txSelect.mock.calls.length === 1 ? selectChain([]) : selectChain([{ maxVersion: 1 }]);
  });
  const tx = {
    select: txSelect,
    insert: vi.fn(() => ({
      values: vi.fn((v: unknown) => {
        capturedInsertValues = v;
        return { returning: vi.fn().mockResolvedValue([{ id: 'new-ver' }]) };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({ returning: vi.fn().mockResolvedValue([nodeRow]) })),
      })),
    })),
  };

  const db = {
    select: vi.fn(() => selectChain([oldVersionRow])),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(tx)),
  };

  const service = new FileVersionsService(
    db as never,
    nodes as never,
    audit as never,
    avScanQueue as never,
  );
  return {
    service,
    db,
    nodes,
    audit,
    avScanQueue,
    getCapturedInsertValues: () => capturedInsertValues as Record<string, unknown>,
  };
}

describe('FileVersionsService.restoreAsNew', () => {
  it('resets avStatus to pending and clears extractedText on the new version row', async () => {
    const { service, getCapturedInsertValues } = makeService();
    await service.restoreAsNew('n1', 1, user);
    const values = getCapturedInsertValues();
    expect(values.avStatus).toBe('pending');
    expect(values.extractedText).toBeNull();
  });

  it('copies content fields (storageKey/size/mime/checksum) from the restored version', async () => {
    const { service, getCapturedInsertValues } = makeService();
    await service.restoreAsNew('n1', 1, user);
    const values = getCapturedInsertValues();
    expect(values.storageKey).toBe('k1');
    expect(values.size).toBe(1000);
    expect(values.mime).toBe('image/png');
    expect(values.checksumSha256).toBe('a'.repeat(64));
  });

  it('enqueues an av-scan job for the new version, re-chaining preview/text-extract', async () => {
    const { service, avScanQueue } = makeService();
    await service.restoreAsNew('n1', 1, user);
    expect(avScanQueue.add).toHaveBeenCalledWith('scan', {
      nodeId: 'n1',
      versionId: 'new-ver',
      storageKey: 'k1',
      mime: 'image/png',
    });
  });

  it('does not fail the request when enqueueing av-scan fails', async () => {
    const { service, avScanQueue } = makeService();
    avScanQueue.add.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.restoreAsNew('n1', 1, user)).resolves.toBeDefined();
  });

  it('returns a DTO carrying avStatus pending', async () => {
    const { service, nodes } = makeService();
    await service.restoreAsNew('n1', 1, user);
    expect(nodes.toDto).toHaveBeenCalledWith(nodeRow, 'pending');
  });

  it('throws when the requested version does not exist', async () => {
    const { service, db } = makeService();
    db.select = vi.fn(() => selectChain([])); // no matching old version
    await expect(service.restoreAsNew('n1', 99, user)).rejects.toMatchObject({
      code: 'files.version.not_found',
    });
  });

  it('requires editor access', async () => {
    const { service, nodes } = makeService();
    nodes.assertAccess.mockRejectedValueOnce(
      Object.assign(new Error('denied'), { code: 'files.node.access_denied' }),
    );
    await expect(service.restoreAsNew('n1', 1, user)).rejects.toMatchObject({
      code: 'files.node.access_denied',
    });
  });
});
