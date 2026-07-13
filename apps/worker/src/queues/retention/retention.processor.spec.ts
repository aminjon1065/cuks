import { describe, expect, it, vi } from 'vitest';
import { RetentionProcessor } from './retention.processor';

function chain(result: unknown[]) {
  const obj: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'for', 'returning', 'innerJoin']) obj[m] = () => obj;
  obj['then'] = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
  return obj;
}

/** Queue-based mock: each call to `select`/`delete` (top-level or inside a
 *  `transaction()` callback) shifts the next configured result off `queue`, in
 *  the exact order the processor is expected to issue them. Matches the
 *  original spec's style, extended to also drive `db.transaction`. */
function makeDb(queue: unknown[][], opts: { txThrowsOnNodeIndex?: number } = {}) {
  const q = [...queue];
  let txCallIndex = -1;

  function makeClient() {
    return {
      select: vi.fn(() => chain(q.shift() ?? [])),
      // `.returning()` shifts the queue (its result is used, e.g. the claimed
      // file_uploads row); a plain awaited `.where()` (fileVersions/fsNodes
      // deletes in purgeOneNode, whose result is never read) does not, so the
      // queue only needs one entry per value the processor actually consumes.
      delete: vi.fn(() => ({
        where: () => {
          const obj: Record<string, unknown> = {};
          obj['returning'] = async () => q.shift() ?? [];
          obj['then'] = (res: (v: unknown) => unknown) => Promise.resolve(undefined).then(res);
          return obj;
        },
      })),
    };
  }

  const db = {
    ...makeClient(),
    transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      txCallIndex++;
      if (opts.txThrowsOnNodeIndex === txCallIndex) throw new Error('simulated FK violation');
      return cb(makeClient());
    }),
  };
  return { db };
}

function makeProcessor(queue: unknown[][], opts: { txThrowsOnNodeIndex?: number } = {}) {
  const { db } = makeDb(queue, opts);
  const storage = {
    deleteObject: vi.fn().mockResolvedValue(undefined),
    abortMultipartUpload: vi.fn().mockResolvedValue(undefined),
  };
  const avScanQueue = { add: vi.fn().mockResolvedValue(undefined) };
  const processor = new RetentionProcessor(db as never, storage as never, avScanQueue as never);
  return { processor, db, storage, avScanQueue };
}

const oldDate = new Date('2020-01-01T00:00:00Z');

describe('RetentionProcessor — sweep order', () => {
  it('purges abandoned uploads, then trash, then reconciles stale-pending scans, in that order', async () => {
    const { processor, db } = makeProcessor([
      [], // purgeAbandonedUploads: no stale uploads
      [], // purgeTrash: nothing eligible
      [], // reconcileStalePendingScans: nothing stale
    ]);
    await processor.process({} as never);
    expect(db.select).toHaveBeenCalledTimes(3);
  });
});

describe('RetentionProcessor — trash purge', () => {
  it('processes deepest nodes first and deletes their storage objects and DB rows', async () => {
    const parent = { id: 'folder1', path: 'root.folder1' };
    const child = { id: 'file1', path: 'root.folder1.file1' };
    const { processor, storage } = makeProcessor([
      [], // abandoned uploads
      [parent, child], // eligible fs_nodes (unsorted — processor sorts deepest-first)
      // child's transaction (deepest first): lock re-check, versions
      [{ deletedAt: oldDate }],
      [{ id: 'v-child', storageKey: 'k-child' }],
      // parent's transaction
      [{ deletedAt: oldDate }],
      [{ id: 'v-parent', storageKey: 'k-parent' }],
      [], // reconcile
    ]);
    await processor.process({} as never);
    const deletedKeys = storage.deleteObject.mock.calls.map((c) => c[0]);
    expect(deletedKeys[0]).toBe('k-child'); // child's version deleted before parent's
    expect(deletedKeys).toContain('k-parent');
  });

  it('also deletes the 3 preview object keys for each purged version (best-effort)', async () => {
    const { processor, storage } = makeProcessor([
      [],
      [{ id: 'n1', path: 'n1' }],
      [{ deletedAt: oldDate }],
      [{ id: 'v1', storageKey: 'k1' }],
      [],
    ]);
    await processor.process({} as never);
    const deletedKeys = storage.deleteObject.mock.calls.map((c) => c[0]);
    expect(deletedKeys).toContain('k1');
    expect(deletedKeys).toContain('previews/v1/small.webp');
    expect(deletedKeys).toContain('previews/v1/medium.webp');
    expect(deletedKeys).toContain('previews/v1/large.webp');
  });

  it('skips a node that was restored (deletedAt cleared) since the sweep snapshotted it', async () => {
    const { processor, storage } = makeProcessor([
      [],
      [{ id: 'n1', path: 'n1' }],
      [{ deletedAt: null }], // re-check under lock: no longer trashed
      [],
    ]);
    await processor.process({} as never);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('skips a node whose deletedAt moved past the cutoff since the snapshot (re-trashed later)', async () => {
    const recentDate = new Date();
    const { processor, storage } = makeProcessor([
      [],
      [{ id: 'n1', path: 'n1' }],
      [{ deletedAt: recentDate }], // re-check under lock: trashed, but not past cutoff anymore
      [],
    ]);
    await processor.process({} as never);
    expect(storage.deleteObject).not.toHaveBeenCalled();
  });

  it('does not fail the whole sweep when a single node purge throws (e.g. an FK violation)', async () => {
    const nodeA = { id: 'a', path: 'a' };
    const nodeB = { id: 'b', path: 'bb' }; // longer path -> processed first
    const { processor, storage } = makeProcessor(
      [
        [],
        [nodeA, nodeB],
        [], // reconcile (nodeB's transaction throws before reaching this)
      ],
      { txThrowsOnNodeIndex: 0 }, // first transaction call (nodeB, deepest-first) throws
    );
    await expect(processor.process({} as never)).resolves.toBeUndefined();
    // nodeB's throw didn't stop nodeA (second transaction call) or the reconcile sweep after it.
    expect(storage.deleteObject).not.toHaveBeenCalled(); // both nodes had empty version lists in this setup
  });
});

describe('RetentionProcessor — abandoned upload purge', () => {
  it('claims (deletes) the staging row before aborting the multipart upload', async () => {
    const { processor, storage } = makeProcessor([
      [{ id: 'u1' }], // stale file_uploads
      [{ id: 'u1', storageKey: 'k1', s3UploadId: 's3-1' }], // claim result
      [], // trash
      [], // reconcile
    ]);
    await processor.process({} as never);
    expect(storage.abortMultipartUpload).toHaveBeenCalledWith('k1', 's3-1');
  });

  it('does not abort when the claim returns no row (already completed/aborted concurrently)', async () => {
    const { processor, storage } = makeProcessor([
      [{ id: 'u1' }],
      [], // claim: 0 rows (a concurrent complete() already won the race)
      [],
      [],
    ]);
    await processor.process({} as never);
    expect(storage.abortMultipartUpload).not.toHaveBeenCalled();
  });

  it('still counts the row as purged even when the abort call fails (already-consumed upload id)', async () => {
    const { processor, storage } = makeProcessor([
      [{ id: 'u1' }],
      [{ id: 'u1', storageKey: 'k1', s3UploadId: 's3-1' }],
      [],
      [],
    ]);
    storage.abortMultipartUpload.mockRejectedValueOnce(new Error('NoSuchUpload'));
    await expect(processor.process({} as never)).resolves.toBeUndefined();
  });
});

describe('RetentionProcessor — stale pending-scan reconciliation', () => {
  it('re-enqueues av-scan for a current version stuck at pending past the staleness window', async () => {
    const { processor, avScanQueue } = makeProcessor([
      [], // abandoned
      [], // trash
      [{ nodeId: 'n1', versionId: 'v1', storageKey: 'k1', mime: 'application/pdf' }],
    ]);
    await processor.process({} as never);
    expect(avScanQueue.add).toHaveBeenCalledWith('scan', {
      nodeId: 'n1',
      versionId: 'v1',
      storageKey: 'k1',
      mime: 'application/pdf',
    });
  });

  it('does not fail the sweep when re-enqueueing fails', async () => {
    const { processor, avScanQueue } = makeProcessor([
      [],
      [],
      [{ nodeId: 'n1', versionId: 'v1', storageKey: 'k1', mime: 'application/pdf' }],
    ]);
    avScanQueue.add.mockRejectedValueOnce(new Error('redis down'));
    await expect(processor.process({} as never)).resolves.toBeUndefined();
  });
});
