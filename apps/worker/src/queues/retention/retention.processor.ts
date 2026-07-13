import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import type { Job, Queue } from 'bullmq';
import {
  fileLinks,
  fileUploads,
  fileVersions,
  fsNodes,
  resourceAcl,
  type Database,
} from '@cuks/db';
import {
  PREVIEW_SIZES,
  QUEUE,
  STALE_PENDING_SCAN_HOURS,
  TRASH_RETENTION_DAYS,
  type FileVersionJobData,
} from '@cuks/shared';
import { previewObjectKey } from '@cuks/shared';
import { DB } from '../../common/db.module';
import { StorageService } from '../../common/storage.service';

/**
 * `retention` queue consumer — three independent sweeps (docs/modules/12 §8):
 * abandoned upload staging rows past their 24h `expires_at`, permanently purge
 * trash older than 30 days, and re-enqueue av-scan for versions stuck at
 * `pending` past `STALE_PENDING_SCAN_HOURS` (an enqueue failure, exhausted
 * BullMQ retries, or an unreachable ClamAV otherwise leaves them pending
 * forever with no self-recovery — docs/plan/STATUS.md 1.3 decision).
 *
 * Order matters: abandoned uploads are purged *before* trash. `file_uploads.
 * parent_id`/`target_node_id` restrict-reference `fs_nodes.id` — a node trashed
 * while an upload targeting it is still staged (a real, if narrow, race in
 * uploads.service.ts's initiate/complete window) would otherwise still have a
 * referencing `file_uploads` row by the time it crosses the 30-day cutoff,
 * and `delete(fsNodes)` would hit a live FK violation. Clearing abandoned
 * uploads first (they're always well past their own 24h TTL by the time a node
 * they reference also crosses 30 days trashed) removes that reference before
 * trash purge ever runs. Per-node purge failures are caught and skipped rather
 * than thrown (see purgeTrash) as a second layer of defense — one unexpected
 * FK reference must not wedge every other eligible node behind it, forever, on
 * every subsequent daily run.
 *
 * Purge order for trash: a node can only be trashed once its parent is already
 * trashed (fs-tree.service.ts's restore() refuses to un-trash a child while its
 * parent stays trashed, and remove()'s cascade only ever *extends* deletedAt
 * down the tree, never re-dates an already-trashed descendant) — so a
 * descendant's `deleted_at` is always <= its ancestors'. That makes eligibility
 * (deletedAt < cutoff) monotonic down the tree: if a parent is eligible, every
 * descendant already is too. Sorting eligible rows by path length descending
 * therefore always processes children before parents, satisfying fs_nodes'
 * self-referencing FK with no extra bookkeeping.
 */
@Processor(QUEUE.retention)
export class RetentionProcessor extends WorkerHost {
  private readonly logger = new Logger(RetentionProcessor.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly storage: StorageService,
    @InjectQueue(QUEUE.avScan) private readonly avScanQueue: Queue<FileVersionJobData>,
  ) {
    super();
  }

  async process(_job: Job): Promise<void> {
    const abandoned = await this.purgeAbandonedUploads();
    const purged = await this.purgeTrash();
    const reconciled = await this.reconcileStalePendingScans();
    const expiredLinks = await this.purgeExpiredLinks();
    this.logger.log({ purged, abandoned, reconciled, expiredLinks }, 'retention sweep complete');
  }

  /** Delete internal links past their expiry. Enforcement already ignores an
   *  expired link (fs-nodes.service.ts joins on `expires_at > now`), so this is
   *  housekeeping — but deleting the link cascades its `file_link_grants`, so the
   *  accepted-user grant rows don't linger either (task 1.4). */
  private async purgeExpiredLinks(): Promise<number> {
    const removed = await this.db
      .delete(fileLinks)
      .where(and(isNotNull(fileLinks.expiresAt), lt(fileLinks.expiresAt, new Date())))
      .returning({ id: fileLinks.id });
    return removed.length;
  }

  private async purgeTrash(): Promise<number> {
    const cutoff = new Date(Date.now() - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const eligible = await this.db
      .select({ id: fsNodes.id, path: fsNodes.path })
      .from(fsNodes)
      .where(and(isNotNull(fsNodes.deletedAt), lt(fsNodes.deletedAt, cutoff)));
    eligible.sort((a, b) => b.path.length - a.path.length); // deepest first

    let purgedCount = 0;
    for (const node of eligible) {
      try {
        if (await this.purgeOneNode(node.id, cutoff)) purgedCount++;
      } catch (err) {
        // One bad node (an unforeseen FK reference, a transient DB error) must
        // not wedge every other eligible node behind it, forever, on every
        // subsequent daily run.
        this.logger.error({ err, nodeId: node.id }, 'failed to purge trashed node, skipping');
      }
    }
    return purgedCount;
  }

  /** Re-verifies eligibility under a row lock immediately before deleting, so a
   *  concurrent restore() (fs-tree.service.ts — a plain `UPDATE ... WHERE id =
   *  :id`, which Postgres blocks on / is blocked by this lock) can't have its
   *  undelete silently destroyed by a sweep that snapshotted the node before the
   *  restore happened. If restore() wins the race, `deletedAt` reads back null
   *  here and this is a no-op; if the purge wins, restore()'s UPDATE affects 0
   *  rows once unblocked and its own subsequent `requireNode()` surfaces a clean
   *  404 rather than a silently-corrupted "success". File-version deletes,
   *  fs_nodes delete, and the lock all share one transaction so a mid-loop crash
   *  can't leave a half-purged node (versions gone, fs_nodes row still present,
   *  or vice versa). */
  private async purgeOneNode(nodeId: string, cutoff: Date): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ deletedAt: fsNodes.deletedAt })
        .from(fsNodes)
        .where(eq(fsNodes.id, nodeId))
        .for('update');
      if (!locked?.deletedAt || locked.deletedAt >= cutoff) return false;

      const versions = await tx
        .select({ id: fileVersions.id, storageKey: fileVersions.storageKey })
        .from(fileVersions)
        .where(eq(fileVersions.nodeId, nodeId));
      for (const v of versions) {
        await this.deleteBestEffort(v.storageKey);
        for (const size of Object.keys(PREVIEW_SIZES)) {
          await this.deleteBestEffort(previewObjectKey(v.id, size)); // no-op if never generated
        }
      }
      await tx.delete(fileVersions).where(eq(fileVersions.nodeId, nodeId));
      // Orphaned ACL grants for this node (resource_acl.resource_id has no FK —
      // polymorphic — so they wouldn't cascade; clean them up here). file_links
      // do cascade via their FK, so they need no explicit delete.
      await tx
        .delete(resourceAcl)
        .where(
          and(
            inArray(resourceAcl.resourceType, ['folder', 'file']),
            eq(resourceAcl.resourceId, nodeId),
          ),
        );
      await tx.delete(fsNodes).where(eq(fsNodes.id, nodeId));
      return true;
    });
  }

  /** Claims (deletes) the staging row *before* aborting the underlying S3
   *  multipart upload — the same ordering `uploads.service.ts`'s complete()/
   *  abort() already use, and for the same reason: a concurrent complete() call
   *  for the same upload id races this sweep once the row is within its last
   *  moments before expiry (e.g. a large upload resuming after a network drop
   *  near the 24h boundary, docs/modules/12 §9's "докачка после обрыва сети").
   *  Aborting first (the old order) could invalidate the multipart upload id out
   *  from under a `CompleteMultipartUpload` that was genuinely about to succeed;
   *  claiming first means only the winner of the DB race ever touches S3. */
  private async purgeAbandonedUploads(): Promise<number> {
    const stale = await this.db
      .select({ id: fileUploads.id })
      .from(fileUploads)
      .where(lt(fileUploads.expiresAt, new Date()));
    let count = 0;
    for (const row of stale) {
      const [claimed] = await this.db
        .delete(fileUploads)
        .where(eq(fileUploads.id, row.id))
        .returning();
      if (!claimed) continue; // already completed/aborted by a concurrent request
      try {
        await this.storage.abortMultipartUpload(claimed.storageKey, claimed.s3UploadId);
      } catch (err) {
        this.logger.warn({ err, uploadId: claimed.id }, 'failed to abort stale multipart upload');
      }
      count++;
    }
    return count;
  }

  /** Re-enqueues av-scan for the *current* version of a non-trashed node still
   *  sitting at `avStatus='pending'` well past normal scan latency — recovers
   *  from an enqueue failure (uploads.service.ts/file-versions.service.ts both
   *  log-and-swallow rather than fail the request) or a permanently-failed scan
   *  job (ClamAV unreachable beyond BullMQ's retry budget). Unconditional/
   *  uncapped: a file that can never be scanned (e.g. one that deterministically
   *  exceeds clamd's stream limit) gets re-tried once a day forever rather than
   *  giving up silently — a bounded resource cost, not a correctness bug, and
   *  strictly better than never recovering (docs/plan/STATUS.md 1.3 decision). */
  private async reconcileStalePendingScans(): Promise<number> {
    const staleCutoff = new Date(Date.now() - STALE_PENDING_SCAN_HOURS * 60 * 60 * 1000);
    const stale = await this.db
      .select({
        nodeId: fsNodes.id,
        versionId: fileVersions.id,
        storageKey: fileVersions.storageKey,
        mime: fileVersions.mime,
      })
      .from(fileVersions)
      .innerJoin(fsNodes, eq(fsNodes.currentVersionId, fileVersions.id))
      .where(
        and(
          eq(fileVersions.avStatus, 'pending'),
          lt(fileVersions.createdAt, staleCutoff),
          isNull(fsNodes.deletedAt),
        ),
      );
    for (const v of stale) {
      try {
        await this.avScanQueue.add('scan', {
          nodeId: v.nodeId,
          versionId: v.versionId,
          storageKey: v.storageKey,
          mime: v.mime,
        });
      } catch (err) {
        this.logger.warn(
          { err, versionId: v.versionId },
          'failed to re-enqueue stale pending scan',
        );
      }
    }
    return stale.length;
  }

  private async deleteBestEffort(key: string): Promise<void> {
    try {
      await this.storage.deleteObject(key);
    } catch (err) {
      this.logger.warn({ err, key }, 'failed to delete object during retention purge');
    }
  }
}
