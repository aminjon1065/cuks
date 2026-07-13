import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, max } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { fileVersions, fsNodes, type Database } from '@cuks/db';
import { QUEUE, type FileVersionDto, type FileVersionJobData, type FsNodeDto } from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { FsNodesService } from './fs-nodes.service';

/**
 * file_versions history (docs/modules/12 §3). Restoring an old version doesn't
 * revert destructively — it creates a new version-copy pointing at the same
 * storage object, so nothing in history is ever lost ("сделать текущей = новая
 * версия-копия").
 */
@Injectable()
export class FileVersionsService {
  private readonly logger = new Logger(FileVersionsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly nodes: FsNodesService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUE.avScan) private readonly avScanQueue: Queue<FileVersionJobData>,
  ) {}

  async list(nodeId: string, user: AuthUser): Promise<FileVersionDto[]> {
    const node = await this.nodes.requireNode(nodeId);
    await this.nodes.assertAccess(node, user, 'viewer');
    const rows = await this.db
      .select()
      .from(fileVersions)
      .where(eq(fileVersions.nodeId, nodeId))
      .orderBy(desc(fileVersions.version));
    return rows.map(toVersionDto);
  }

  async restoreAsNew(nodeId: string, version: number, user: AuthUser): Promise<FsNodeDto> {
    const node = await this.nodes.requireNode(nodeId);
    await this.nodes.assertAccess(node, user, 'editor');
    const [old] = await this.db
      .select()
      .from(fileVersions)
      .where(and(eq(fileVersions.nodeId, nodeId), eq(fileVersions.version, version)))
      .limit(1);
    if (!old) throw AppException.notFound('files.version.not_found', 'Version not found');

    const result = await this.db.transaction(async (tx) => {
      // Row lock so a concurrent version-creating call for the same node (another
      // restoreAsNew(), or UploadsService.complete()'s new-version path) can't
      // compute the same next version number.
      await tx.select().from(fsNodes).where(eq(fsNodes.id, nodeId)).for('update');
      const [row] = await tx
        .select({ maxVersion: max(fileVersions.version) })
        .from(fileVersions)
        .where(eq(fileVersions.nodeId, nodeId));
      const newVersion = (row?.maxVersion ?? 0) + 1;
      const [versionRow] = await tx
        .insert(fileVersions)
        .values({
          nodeId,
          version: newVersion,
          storageKey: old.storageKey,
          size: old.size,
          mime: old.mime,
          checksumSha256: old.checksumSha256,
          uploadedBy: user.id,
          // Re-scan rather than trust a historical verdict (signature DBs move on,
          // and this also re-chains preview/text-extract for the new version id —
          // both are keyed by version id, so a restored version starts with
          // neither until av-scan regenerates them on a clean verdict).
          avStatus: 'pending',
          extractedText: null,
        })
        .returning();
      const [updated] = await tx
        .update(fsNodes)
        .set({ currentVersionId: versionRow!.id, sizeCached: old.size, mime: old.mime })
        .where(eq(fsNodes.id, nodeId))
        .returning();
      return { node: updated!, versionId: versionRow!.id };
    });

    this.audit.log({
      action: 'files.version.restored',
      actorId: user.id,
      entityType: 'file',
      entityId: nodeId,
      meta: { fromVersion: version },
    });
    await this.enqueueAvScan(result.node.id, result.versionId, old.storageKey, old.mime);
    return this.nodes.toDto(result.node, 'pending');
  }

  /** Same fire-and-log-don't-fail contract as UploadsService.enqueueAvScan — the
   *  new version row is already committed, so a queue failure doesn't fail the
   *  request; retention's stale-pending reconciliation sweep picks it up later. */
  private async enqueueAvScan(
    nodeId: string,
    versionId: string,
    storageKey: string,
    mime: string,
  ): Promise<void> {
    try {
      await this.avScanQueue.add('scan', { nodeId, versionId, storageKey, mime });
    } catch (err) {
      this.logger.error(
        { err, nodeId, versionId },
        'failed to enqueue av-scan for restored version',
      );
    }
  }
}

function toVersionDto(row: typeof fileVersions.$inferSelect): FileVersionDto {
  return {
    id: row.id,
    version: row.version,
    size: row.size,
    mime: row.mime,
    checksumSha256: row.checksumSha256,
    uploadedBy: row.uploadedBy,
    avStatus: row.avStatus,
    createdAt: row.createdAt.toISOString(),
  };
}
