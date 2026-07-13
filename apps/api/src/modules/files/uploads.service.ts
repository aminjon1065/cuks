import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, max } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { fileUploads, fileVersions, fsNodes, type Database } from '@cuks/db';
import {
  MAX_FILE_SIZE_BYTES,
  QUEUE,
  UPLOAD_PART_SIZE_BYTES,
  UPLOAD_STAGING_TTL_HOURS,
  type CompleteUploadInput,
  type FileVersionJobData,
  type FsNodeDto,
  type InitiateUploadInput,
  type InitiateUploadResponse,
  type UploadPartUrl,
} from '@cuks/shared';
import { uuidv7 } from 'uuidv7';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { StorageService } from '../../common/storage/storage.service';
import { DB } from '../../common/db/db.module';
import { FsNodesService, type FsNode } from './fs-nodes.service';

/**
 * Presigned multipart upload orchestration (docs/modules/12 §4): initiate ->
 * client uploads parts directly to MinIO -> complete creates the fs_node +
 * file_version. `file_uploads` is a staging row the client can't spoof the
 * server-validated destination/owner of (checked once, at initiate time, and
 * re-checked at complete time — see complete()'s comments).
 */
@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly nodes: FsNodesService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    @InjectQueue(QUEUE.avScan) private readonly avScanQueue: Queue<FileVersionJobData>,
  ) {}

  async initiate(input: InitiateUploadInput, user: AuthUser): Promise<InitiateUploadResponse> {
    let parentId: string | null = null;
    let targetNodeId: string | null = null;
    let ownerUserId: string | null = null;
    let ownerOrgUnitId: string | null = null;

    if (input.targetNodeId) {
      const target = await this.nodes.requireNode(input.targetNodeId);
      if (target.kind !== 'file') {
        throw AppException.badRequest('files.upload.target_not_file', 'Target node is not a file');
      }
      await this.nodes.assertAccess(target, user, 'editor');
      targetNodeId = target.id;
      ownerUserId = target.ownerUserId;
      ownerOrgUnitId = target.ownerOrgUnitId;
    } else {
      const resolved = await this.nodes.resolveTarget(
        input.space,
        input.parentId ?? null,
        input.orgUnitId,
        user,
      );
      if (resolved.parent) await this.nodes.assertAccess(resolved.parent, user, 'editor');
      await this.nodes.assertNoSibling(
        resolved.parent?.id ?? null,
        input.space,
        resolved.ownerUserId,
        resolved.ownerOrgUnitId,
        input.name,
      );
      parentId = resolved.parent?.id ?? null;
      ownerUserId = resolved.ownerUserId;
      ownerOrgUnitId = resolved.ownerOrgUnitId;
    }

    await this.nodes.assertQuota(input.space, ownerUserId, ownerOrgUnitId, input.size);

    const key = `fs/${input.space}/${uuidv7()}`;
    const { uploadId: s3UploadId } = await this.storage.initiateUpload(key, input.mime, input.size);
    const partCount = Math.max(1, Math.ceil(input.size / UPLOAD_PART_SIZE_BYTES));
    const parts: UploadPartUrl[] = [];
    for (let partNumber = 1; partNumber <= partCount; partNumber++) {
      parts.push({
        partNumber,
        url: await this.storage.getUploadPartUrl(key, s3UploadId, partNumber),
      });
    }

    const [staging] = await this.db
      .insert(fileUploads)
      .values({
        storageKey: key,
        s3UploadId,
        parentId,
        targetNodeId,
        name: input.name,
        space: input.space,
        ownerUserId,
        ownerOrgUnitId,
        declaredSize: input.size,
        mime: input.mime,
        createdBy: user.id,
        expiresAt: new Date(Date.now() + UPLOAD_STAGING_TTL_HOURS * 60 * 60 * 1000),
      })
      .returning();
    return { uploadId: staging!.id, parts };
  }

  /**
   * `storage.completeUpload()` is an irreversible external call — it consumes the
   * S3 multipart upload id, so it can't be retried on failure afterward. Every
   * check that could otherwise make the DB write fail (target still exists, access
   * still held, no name collision, size/quota limits) runs *before* that call, on
   * the up-to-date state, not the possibly-stale `input.space`/owner the client
   * repeated from initiate. The staging row is claimed atomically (delete-and-
   * return) immediately before the storage call so a duplicate/retried request
   * can't call it twice; if anything fails after the storage merge commits, the
   * now-orphaned object is deleted rather than left unreferenced.
   */
  async complete(uploadId: string, input: CompleteUploadInput, user: AuthUser): Promise<FsNodeDto> {
    const staging = await this.requireStaging(uploadId, user);

    let targetNode: FsNode | null = null;
    if (staging.targetNodeId) {
      targetNode = await this.nodes.requireNode(staging.targetNodeId);
      await this.nodes.assertAccess(targetNode, user, 'editor');
    } else {
      if (staging.parentId) await this.nodes.requireNode(staging.parentId);
      await this.nodes.assertNoSibling(
        staging.parentId,
        staging.space,
        staging.ownerUserId,
        staging.ownerOrgUnitId,
        staging.name,
      );
    }

    // The node's real space/owner, never the client-repeated staging.space — for a
    // new-version upload that must be the target's actual space, or a client could
    // claim 'system' (unquota'd) to upload a version of a personal/org file.
    const realSpace = targetNode?.space ?? staging.space;
    const realOwnerUserId = targetNode?.ownerUserId ?? staging.ownerUserId;
    const realOwnerOrgUnitId = targetNode?.ownerOrgUnitId ?? staging.ownerOrgUnitId;

    const [claimed] = await this.db
      .delete(fileUploads)
      .where(eq(fileUploads.id, uploadId))
      .returning();
    if (!claimed) {
      throw AppException.notFound(
        'files.upload.not_found',
        'Upload session not found (already completed or aborted)',
      );
    }

    let completed;
    try {
      completed = await this.storage.completeUpload(
        claimed.storageKey,
        claimed.s3UploadId,
        input.parts,
      );
    } catch (err) {
      throw AppException.badRequest(
        'files.upload.complete_failed',
        'Failed to complete the upload — check the submitted parts',
        { cause: err instanceof Error ? err.message : String(err) },
      );
    }

    try {
      // initiate() only validated the client-*declared* size; the presigned part
      // URL has no Content-Length limit, so re-check against the real merged size.
      if (completed.size > MAX_FILE_SIZE_BYTES) {
        throw AppException.badRequest(
          'files.upload.too_large',
          'Uploaded file exceeds the 2 GiB limit',
          {
            maxBytes: MAX_FILE_SIZE_BYTES,
            actualBytes: completed.size,
          },
        );
      }
      if (realSpace !== 'system') {
        const previousSize = targetNode?.sizeCached ?? 0;
        const { usedBytes, quotaBytes } = await this.nodes.usage(
          realSpace,
          realOwnerUserId,
          realOwnerOrgUnitId,
        );
        if (quotaBytes !== null && usedBytes - previousSize + completed.size > quotaBytes) {
          throw AppException.unprocessable('files.quota.exceeded', 'Storage quota exceeded', {
            usedBytes,
            quotaBytes,
            uploadedBytes: completed.size,
          });
        }
      }

      const result = await this.db.transaction(async (tx) => {
        let node: FsNode;
        let version: number;
        if (targetNode) {
          // Row lock so two concurrent version-creating calls for the same node
          // (another complete(), or FileVersionsService.restoreAsNew()) can't both
          // compute the same next version number.
          const [locked] = await tx
            .select()
            .from(fsNodes)
            .where(eq(fsNodes.id, targetNode.id))
            .for('update');
          node = locked!;
          const [row] = await tx
            .select({ maxVersion: max(fileVersions.version) })
            .from(fileVersions)
            .where(eq(fileVersions.nodeId, node.id));
          version = (row?.maxVersion ?? 0) + 1;
        } else {
          const id = uuidv7();
          const path = claimed.parentId
            ? `${(await this.nodes.requireNode(claimed.parentId, tx)).path}.${id}`
            : id;
          const [created] = await tx
            .insert(fsNodes)
            .values({
              id,
              parentId: claimed.parentId,
              kind: 'file',
              name: claimed.name,
              space: claimed.space,
              ownerUserId: claimed.ownerUserId,
              ownerOrgUnitId: claimed.ownerOrgUnitId,
              mime: claimed.mime,
              path,
              createdBy: user.id,
            })
            .returning();
          node = created!;
          version = 1;
        }

        const [versionRow] = await tx
          .insert(fileVersions)
          .values({
            nodeId: node!.id,
            version,
            storageKey: claimed.storageKey,
            size: completed.size,
            mime: claimed.mime,
            checksumSha256: input.checksumSha256,
            uploadedBy: user.id,
          })
          .returning();

        const [updated] = await tx
          .update(fsNodes)
          .set({ currentVersionId: versionRow!.id, sizeCached: completed.size, mime: claimed.mime })
          .where(eq(fsNodes.id, node!.id))
          .returning();
        return updated!;
      });

      this.audit.log({
        action: claimed.targetNodeId ? 'files.file.version_uploaded' : 'files.file.uploaded',
        actorId: user.id,
        entityType: 'file',
        entityId: result.id,
      });
      await this.enqueueAvScan(result, claimed.storageKey, claimed.mime);
      // The version just inserted always starts 'pending' (schema default) — no
      // extra query needed to know that.
      return this.nodes.toDto(result, 'pending');
    } catch (err) {
      // The storage merge already committed (irreversible) — clean up rather than
      // leave a MinIO object unreferenced by any fs_node/file_version.
      await this.storage.deleteObject(claimed.storageKey).catch(() => {});
      throw err;
    }
  }

  async abort(uploadId: string, user: AuthUser): Promise<void> {
    const staging = await this.requireStaging(uploadId, user);
    const [claimed] = await this.db
      .delete(fileUploads)
      .where(eq(fileUploads.id, uploadId))
      .returning();
    if (!claimed) return; // already completed/aborted by a concurrent call
    await this.storage.abortUpload(staging.storageKey, staging.s3UploadId);
  }

  /**
   * Best-effort but loud: the fs_node/file_version are already committed at this
   * point (the upload genuinely succeeded), so a queue failure doesn't fail the
   * request — the version just stays `pending` until reprocessed. Logged at error
   * (not mail's warn) since an un-scanned file silently staying downloadable is
   * a real security-relevant miss, not a cosmetic one.
   */
  private async enqueueAvScan(node: FsNode, storageKey: string, mime: string): Promise<void> {
    try {
      await this.avScanQueue.add('scan', {
        nodeId: node.id,
        versionId: node.currentVersionId!,
        storageKey,
        mime,
      });
    } catch (err) {
      this.logger.error({ err, nodeId: node.id }, 'failed to enqueue av-scan');
    }
  }

  private async requireStaging(
    uploadId: string,
    user: AuthUser,
  ): Promise<typeof fileUploads.$inferSelect> {
    const [staging] = await this.db
      .select()
      .from(fileUploads)
      .where(eq(fileUploads.id, uploadId))
      .limit(1);
    if (!staging) throw AppException.notFound('files.upload.not_found', 'Upload session not found');
    if (staging.createdBy !== user.id) {
      throw AppException.forbidden('files.upload.forbidden', 'Not your upload session');
    }
    return staging;
  }
}
