import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { documentFiles, fileVersions, fsNodes, type Database } from '@cuks/db';
import {
  DOCFLOW_FILES_ROOT_NAME,
  previewObjectKey,
  type AvStatus,
  type PreviewSize,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB } from '../../common/db/db.module';
import { AppException } from '../../common/exceptions/app.exception';
import { StorageService } from '../../common/storage/storage.service';
import { DocumentsService } from './documents.service';
import { ReadLogService } from './read-log.service';

/** Serialises the lazy creation of the system-space folders (root + per-document). */
const DOCFLOW_FILES_LOCK_KEY = 0x0d0c_f11e;

/**
 * Only a `clean` version may be served through a document. `infected` is obvious;
 * `pending` is denied too — a document body reaches every route participant, every
 * acquaintance and the whole chancellery, so distributing bytes the scanner has not
 * cleared yet is exactly the exposure this gate exists to close (docs/09 §2). The
 * general file manager is laxer on purpose: there a file is read by its own uploader.
 */
export function assertVersionServable(avStatus: AvStatus | null): void {
  if (avStatus === 'clean') return;
  if (avStatus === 'infected') {
    throw AppException.forbidden(
      'docflow.file.not_safe',
      'The antivirus scan flagged this file; it cannot be served',
      { avStatus },
    );
  }
  // `pending` (still scanning) and a missing version are both "not cleared yet".
  throw AppException.forbidden(
    'docflow.file.not_safe',
    'This file has not cleared the antivirus scan yet',
    { avStatus: avStatus ?? 'pending' },
  );
}

/**
 * Move an uploaded node into the docflow system tree, within the caller's transaction
 * (docs/modules/11 §12.2, plan этап 1C). Before this, a document pointed at a node
 * sitting in the uploader's personal space: the uploader could delete, move or re-share
 * the body of a registered document, and every other participant — who has no ACL on
 * that personal node — could not read it at all.
 *
 * After adoption the node lives at `system/docflow/<documentId>/`, owned by nobody: the
 * file ACL denies everyone except a superadmin, so the ONLY way in is the document
 * policy. Idempotent — a node already inside the tree is left alone, which is what makes
 * the backfill and any re-attach safe to re-run.
 */
export async function adoptDocumentFile(
  tx: Database,
  nodeId: string,
  documentId: string,
): Promise<void> {
  const [node] = await tx.select().from(fsNodes).where(eq(fsNodes.id, nodeId)).limit(1);
  if (!node) {
    throw AppException.badRequest(
      'docflow.document.file_missing',
      'The referenced file does not exist',
    );
  }
  if (node.kind !== 'file') {
    throw AppException.badRequest(
      'docflow.document.file_not_a_file',
      'Only a file can be attached to a document',
    );
  }
  if (node.deletedAt) {
    throw AppException.badRequest(
      'docflow.document.file_missing',
      'The referenced file does not exist',
    );
  }
  const folderId = await ensureDocumentFolder(tx, documentId);
  if (node.space === 'system' && node.parentId === folderId) return; // already adopted

  const [folder] = await tx.select().from(fsNodes).where(eq(fsNodes.id, folderId)).limit(1);
  if (!folder) throw new Error('the docflow system folder vanished mid-transaction');
  await tx
    .update(fsNodes)
    .set({
      space: 'system',
      parentId: folder.id,
      path: `${folder.path}.${node.id}`,
      // Ownership moves to the institution: the node stops counting against the
      // uploader's quota and stops being reachable from their personal tree.
      ownerUserId: null,
      ownerOrgUnitId: null,
    })
    .where(eq(fsNodes.id, node.id));
}

/** The `system/docflow/<documentId>` folder, created on first use. */
async function ensureDocumentFolder(tx: Database, documentId: string): Promise<string> {
  const rootId = await ensureFolder(tx, null, DOCFLOW_FILES_ROOT_NAME);
  return ensureFolder(tx, rootId, documentId);
}

/**
 * Find-or-create one system-space folder. An advisory lock held for the transaction
 * serialises concurrent first-attachments, which would otherwise both insert the root.
 */
async function ensureFolder(tx: Database, parentId: string | null, name: string): Promise<string> {
  const where = and(
    eq(fsNodes.space, 'system'),
    eq(fsNodes.kind, 'folder'),
    eq(fsNodes.name, name),
    parentId ? eq(fsNodes.parentId, parentId) : isNull(fsNodes.parentId),
    isNull(fsNodes.deletedAt),
  );
  const [found] = await tx.select({ id: fsNodes.id }).from(fsNodes).where(where).limit(1);
  if (found) return found.id;

  await tx.execute(sql`select pg_advisory_xact_lock(${DOCFLOW_FILES_LOCK_KEY})`);
  const [afterLock] = await tx.select({ id: fsNodes.id }).from(fsNodes).where(where).limit(1);
  if (afterLock) return afterLock.id;

  let parentPath: string | null = null;
  if (parentId) {
    const [parent] = await tx
      .select({ path: fsNodes.path })
      .from(fsNodes)
      .where(eq(fsNodes.id, parentId))
      .limit(1);
    if (!parent) throw new Error('the docflow system root vanished mid-transaction');
    parentPath = parent.path;
  }
  // `path` embeds the row's own id, so insert first and patch the path with it.
  const [created] = await tx
    .insert(fsNodes)
    .values({ kind: 'folder', name, space: 'system', parentId, path: 'pending' })
    .returning({ id: fsNodes.id });
  if (!created) throw new Error('system folder insert did not return an id');
  await tx
    .update(fsNodes)
    .set({ path: parentPath ? `${parentPath}.${created.id}` : created.id })
    .where(eq(fsNodes.id, created.id));
  return created.id;
}

/**
 * Guarded access to a document's files (docs/modules/11 §12.2, plan этап 1C). Every read
 * re-derives the answer from the document — visibility and ДСП first, then the link
 * actually belonging to THIS document, then the antivirus verdict — and only then mints a
 * short-lived presigned URL. No permanent object URL is ever handed out, and a caller who
 * cannot see the document gets the same 404 as for a document that does not exist.
 */
@Injectable()
export class DocflowFilesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly documents: DocumentsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly readLog: ReadLogService,
  ) {}

  /** A time-limited URL for the file body, or a 403/404 explaining nothing extra. */
  async downloadUrl(documentId: string, fileId: string, user: AuthUser): Promise<string> {
    const file = await this.resolve(documentId, fileId, user);
    this.recordRead(documentId, fileId, file.versionId, file.isDsp, user, 'download');
    return this.storage.getDownloadUrl(file.storageKey, file.name);
  }

  /** Same gate, for a generated preview tile. A missing preview is a plain 404. */
  async previewUrl(
    documentId: string,
    fileId: string,
    size: PreviewSize,
    user: AuthUser,
  ): Promise<string> {
    const file = await this.resolve(documentId, fileId, user);
    const key = previewObjectKey(file.versionId, size);
    if (!(await this.storage.objectExists(key))) {
      throw AppException.notFound('docflow.file.preview_not_found', 'Preview not available');
    }
    this.recordRead(documentId, fileId, file.versionId, file.isDsp, user, 'preview');
    return this.storage.getDownloadUrl(key, `${file.name}-${size}.webp`);
  }

  /**
   * The full gate. `assertVisible` throws 404 for an invisible or ДСП-without-allow-list
   * document, so file ids cannot be probed to learn a document exists.
   */
  private async resolve(
    documentId: string,
    fileId: string,
    user: AuthUser,
  ): Promise<{
    storageKey: string;
    versionId: string;
    name: string;
    isDsp: boolean;
  }> {
    const document = await this.documents.assertVisible(documentId, user);
    // The link must belong to THIS document: a valid file id from another document
    // must not become readable by pairing it with a document the caller can see.
    const [link] = await this.db
      .select({ id: documentFiles.id })
      .from(documentFiles)
      .where(and(eq(documentFiles.documentId, documentId), eq(documentFiles.fileId, fileId)))
      .limit(1);
    if (!link) {
      throw AppException.notFound('docflow.document.file_not_found', 'File not found');
    }
    const [node] = await this.db
      .select({
        name: fsNodes.name,
        kind: fsNodes.kind,
        deletedAt: fsNodes.deletedAt,
        currentVersionId: fsNodes.currentVersionId,
      })
      .from(fsNodes)
      .where(eq(fsNodes.id, fileId))
      .limit(1);
    if (!node || node.kind !== 'file' || node.deletedAt || !node.currentVersionId) {
      throw AppException.notFound('docflow.document.file_not_found', 'File not found');
    }
    const [version] = await this.db
      .select({ storageKey: fileVersions.storageKey, avStatus: fileVersions.avStatus })
      .from(fileVersions)
      .where(eq(fileVersions.id, node.currentVersionId))
      .limit(1);
    assertVersionServable(version?.avStatus ?? null);
    if (!version) throw new Error('current_version_id points to a missing file_versions row');
    return {
      storageKey: version.storageKey,
      versionId: node.currentVersionId,
      name: node.name,
      isDsp: document.confidentiality === 'dsp',
    };
  }

  /** Audit every served body; ДСП additionally lands in the access trail (docs/09 §3). */
  private recordRead(
    documentId: string,
    fileId: string,
    versionId: string,
    isDsp: boolean,
    user: AuthUser,
    mode: 'download' | 'preview',
  ): void {
    this.audit.log({
      action: 'docflow.document.file_downloaded',
      actorId: user.id,
      entityType: 'document',
      entityId: documentId,
      meta: { fileId, versionId, mode },
    });
    if (isDsp) this.readLog.record('document', documentId);
  }
}
