import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, max } from 'drizzle-orm';
import { fileVersions, fsNodes, type Database } from '@cuks/db';
import type { FileVersionDto, FsNodeDto } from '@cuks/shared';
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
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly nodes: FsNodesService,
    private readonly audit: AuditService,
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
          avStatus: old.avStatus,
          extractedText: old.extractedText,
        })
        .returning();
      const [updated] = await tx
        .update(fsNodes)
        .set({ currentVersionId: versionRow!.id, sizeCached: old.size, mime: old.mime })
        .where(eq(fsNodes.id, nodeId))
        .returning();
      return updated!;
    });

    this.audit.log({
      action: 'files.version.restored',
      actorId: user.id,
      entityType: 'file',
      entityId: nodeId,
      meta: { fromVersion: version },
    });
    return this.nodes.toDto(result);
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
