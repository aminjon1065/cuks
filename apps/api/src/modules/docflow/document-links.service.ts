import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import { documentLinks, documents, type Database } from '@cuks/db';
import type { CreateDocumentLinkInput, DocumentLinkDto } from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { canViewDocumentBase } from './document-visibility';
import { DocumentsService } from './documents.service';

/**
 * Document links / связи (docs/modules/11 §3/§7, task 3.7). A link relates two documents
 * (a plain association or a reply); it shows on both cards (the list unions src=id and
 * dst=id). The caller must be able to view both documents to link them, and a linked
 * document is only surfaced if the caller can base-view it (no ДСП leak via the sheet).
 */
@Injectable()
export class DocumentLinksService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly documents: DocumentsService,
  ) {}

  async add(
    documentId: string,
    input: CreateDocumentLinkInput,
    actor: AuthUser,
  ): Promise<DocumentLinkDto[]> {
    if (input.targetId === documentId) {
      throw AppException.badRequest('docflow.link.self', 'A document cannot link to itself');
    }
    // The caller must be able to view both ends (linking a document you cannot see would
    // leak its existence).
    await this.documents.assertVisible(documentId, actor);
    await this.documents.assertVisible(input.targetId, actor);

    const [existing] = await this.db
      .select({ id: documentLinks.id })
      .from(documentLinks)
      .where(
        or(
          and(
            eq(documentLinks.srcDocumentId, documentId),
            eq(documentLinks.dstDocumentId, input.targetId),
          ),
          and(
            eq(documentLinks.srcDocumentId, input.targetId),
            eq(documentLinks.dstDocumentId, documentId),
          ),
        ),
      )
      .limit(1);
    if (existing) {
      throw AppException.conflict('docflow.link.exists', 'These documents are already linked');
    }

    await this.db.insert(documentLinks).values({
      srcDocumentId: documentId,
      dstDocumentId: input.targetId,
      kind: input.kind,
      createdBy: actor.id,
    });
    this.audit.log({
      action: 'docflow.document.linked',
      actorId: actor.id,
      entityType: 'document',
      entityId: documentId,
      meta: { targetId: input.targetId, kind: input.kind },
    });
    return this.forDocument(documentId, actor);
  }

  async remove(documentId: string, linkId: string, actor: AuthUser): Promise<DocumentLinkDto[]> {
    await this.documents.assertVisible(documentId, actor);
    const [link] = await this.db
      .select()
      .from(documentLinks)
      .where(eq(documentLinks.id, linkId))
      .limit(1);
    if (!link || (link.srcDocumentId !== documentId && link.dstDocumentId !== documentId)) {
      throw AppException.notFound('docflow.link.not_found', 'Link not found');
    }
    await this.db.delete(documentLinks).where(eq(documentLinks.id, linkId));
    this.audit.log({
      action: 'docflow.document.unlinked',
      actorId: actor.id,
      entityType: 'document',
      entityId: documentId,
      meta: { linkId },
    });
    return this.forDocument(documentId, actor);
  }

  /** The document's links, bidirectional, resolving the OTHER document — filtered to
   *  non-deleted documents the caller may base-view. */
  async forDocument(documentId: string, actor: AuthUser): Promise<DocumentLinkDto[]> {
    await this.documents.assertVisible(documentId, actor);
    const rows = await this.db
      .select({
        id: documentLinks.id,
        kind: documentLinks.kind,
        srcId: documentLinks.srcDocumentId,
        createdAt: documentLinks.createdAt,
        other: documents,
      })
      .from(documentLinks)
      .innerJoin(
        documents,
        or(
          and(
            eq(documentLinks.srcDocumentId, documentId),
            eq(documents.id, documentLinks.dstDocumentId),
          ),
          and(
            eq(documentLinks.dstDocumentId, documentId),
            eq(documents.id, documentLinks.srcDocumentId),
          ),
        ),
      )
      .where(
        and(
          or(
            eq(documentLinks.srcDocumentId, documentId),
            eq(documentLinks.dstDocumentId, documentId),
          ),
          isNull(documents.deletedAt),
        ),
      )
      .orderBy(desc(documentLinks.createdAt));

    return rows
      .filter((r) => canViewDocumentBase(r.other, actor))
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        documentId: r.other.id,
        regNumber: r.other.regNumber,
        subject: r.other.subject,
        status: r.other.status,
        createdAt: r.createdAt.toISOString(),
      }));
  }
}
