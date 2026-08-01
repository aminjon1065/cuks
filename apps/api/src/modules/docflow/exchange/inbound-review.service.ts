import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  correspondents,
  documentExchangeAttachments,
  documentExchangeInbound,
  documents,
  fileVersions,
  fsNodes,
  type Database,
} from '@cuks/db';
import type {
  InboundExchangeAttachmentDto,
  InboundExchangeDto,
  InboundExchangeQuery,
  PaginatedResult,
  RegisterInboundExchangeInput,
  RejectInboundExchangeInput,
} from '@cuks/shared';
import { AuditService } from '../../../common/audit/audit.service';
import type { AuthUser } from '../../../common/auth/auth-user';
import { AppException } from '../../../common/exceptions/app.exception';
import { DB } from '../../../common/db/db.module';
import { DocumentsService } from '../documents.service';
import { hasRegistryAccess } from '../document-visibility';
import { planPromotion } from './inbound-policy';

/**
 * The review queue for messages that arrived but are not documents yet (plan этап 10
 * «Mapping external correspondent/type в quarantined review queue»).
 *
 * A reviewer answers exactly the questions the machine refused to guess: who sent this, and
 * what kind of letter is it. Everything else — the number, the date, the audit entry — comes
 * from the ordinary registration command, so an exchanged letter is registered exactly like
 * one carried in on paper. A second registration path would eventually mint numbers by
 * different rules than the counter the chancellery trusts.
 *
 * Chancellery rights throughout: registering here mints a registration number, which is the
 * same act the register guards everywhere else.
 */
@Injectable()
export class InboundReviewService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
  ) {}

  async list(
    query: InboundExchangeQuery,
    actor: AuthUser,
  ): Promise<PaginatedResult<InboundExchangeDto>> {
    this.assertRights(actor);
    // No status means «то, что ещё не разобрано» — the queue a person opens it for. Everything
    // already registered or refused is history and needs an explicit filter to see.
    const where = query.status
      ? eq(documentExchangeInbound.status, query.status)
      : inArray(documentExchangeInbound.status, ['received', 'quarantined']);

    const offset = (query.page - 1) * query.limit;
    const [rows, totals] = await Promise.all([
      this.db
        .select({
          row: documentExchangeInbound,
          correspondentName: correspondents.name,
          documentRegNumber: documents.regNumber,
        })
        .from(documentExchangeInbound)
        .leftJoin(correspondents, eq(correspondents.id, documentExchangeInbound.correspondentId))
        .leftJoin(documents, eq(documents.id, documentExchangeInbound.documentId))
        .where(where)
        // Oldest first: a review queue is worked through, and the letter that has waited
        // longest is the one somebody is waiting on.
        .orderBy(documentExchangeInbound.receivedAt)
        .limit(query.limit)
        .offset(offset),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(documentExchangeInbound)
        .where(where),
    ]);

    const attachments = await this.attachmentsFor(rows.map((r) => r.row.id));
    return {
      items: rows.map((r) =>
        this.toDto(r.row, attachments.get(r.row.id) ?? [], {
          correspondentName: r.correspondentName,
          documentRegNumber: r.documentRegNumber,
        }),
      ),
      total: totals[0]?.n ?? 0,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * Turn a reviewed message into a registered incoming document.
   *
   * The message id doubles as the registration idempotency key: registering the same message
   * twice cannot mint two numbers, whatever a double-click or a retried request does.
   */
  async register(
    id: string,
    input: RegisterInboundExchangeInput,
    actor: AuthUser,
  ): Promise<InboundExchangeDto> {
    this.assertRights(actor);
    const message = await this.requireMessage(id);
    if (message.status === 'registered') {
      throw AppException.conflict(
        'docflow.exchange.already_registered',
        'This message is already registered',
        { documentId: message.documentId },
      );
    }
    if (message.status === 'rejected') {
      throw AppException.conflict(
        'docflow.exchange.rejected',
        'A refused message cannot be registered',
      );
    }

    const attachments = await this.attachmentsFor([id]);
    const files = attachments.get(id) ?? [];
    // The gate the whole slice exists for: the reviewer's answers resolve the reference data,
    // but they do not resolve an unfinished scan or an infected file. `planPromotion` is the
    // same decision the automatic promoter makes — one rule, not two.
    const decision = planPromotion({
      avStatuses: files.map((f) => f.avStatus ?? 'pending'),
      correspondentId: input.correspondentId,
      typeCode: input.typeCode,
    });
    if (decision.action !== 'register') {
      throw AppException.unprocessable(
        decision.action === 'wait'
          ? 'docflow.exchange.scan_pending'
          : 'docflow.exchange.not_registrable',
        decision.action === 'wait'
          ? 'The antivirus has not finished with every attachment yet'
          : 'The message cannot be registered in its current state',
        { reason: decision.action === 'wait' ? 'scan_pending' : decision.reason },
      );
    }

    const document = await this.documents.registerIncoming(
      {
        // Stable by construction: the message id IS the key, so a replay returns the document
        // that already exists instead of minting a second number.
        idempotencyKey: id,
        journalId: input.journalId,
        typeCode: input.typeCode,
        subject: input.subject ?? message.subject,
        summary: message.summary,
        correspondentId: input.correspondentId,
        confidentiality: input.confidentiality,
        senderName: message.senderName,
        senderContact: message.senderContact,
        outgoingDate: message.sentAt?.toISOString() ?? null,
        dueDate: input.dueDate ?? null,
        caseIndex: input.caseIndex ?? null,
        // The first attachment is the body; the rest travel beside it. A transport that sent
        // one file sent the letter itself, which is the overwhelmingly common case.
        files: files.map((f, i) => ({
          fileId: f.fileId,
          kind: i === 0 ? ('main' as const) : ('attachment' as const),
          title: f.fileName,
        })),
      },
      actor,
    );

    await this.db
      .update(documentExchangeInbound)
      .set({
        status: 'registered',
        documentId: document.id,
        correspondentId: input.correspondentId,
        typeCode: input.typeCode,
        quarantineReason: null,
        resolvedAt: new Date(),
        resolvedBy: actor.id,
        updatedAt: new Date(),
      })
      // Guarded on the state we read: a concurrent reviewer must not overwrite a decision.
      .where(
        and(
          eq(documentExchangeInbound.id, id),
          inArray(documentExchangeInbound.status, ['received', 'quarantined']),
        ),
      );

    await this.audit.logAndWait({
      action: 'docflow.exchange.registered',
      actorId: actor.id,
      entityType: 'document',
      entityId: document.id,
      meta: {
        inboundId: id,
        adapterId: message.adapterId,
        externalId: message.externalId,
        journalId: input.journalId,
      },
    });
    return this.requireDto(id);
  }

  /** Refuse a message for good, with a reason a person can read later. */
  async reject(
    id: string,
    input: RejectInboundExchangeInput,
    actor: AuthUser,
  ): Promise<InboundExchangeDto> {
    this.assertRights(actor);
    const [row] = await this.db
      .update(documentExchangeInbound)
      .set({
        status: 'rejected',
        rejectedReason: input.reason.trim(),
        resolvedAt: new Date(),
        resolvedBy: actor.id,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(documentExchangeInbound.id, id),
          // A registered message is a document now; refusing it here would leave the register
          // and the queue telling different stories about the same letter.
          inArray(documentExchangeInbound.status, ['received', 'quarantined']),
        ),
      )
      .returning({ id: documentExchangeInbound.id });
    if (!row) {
      throw AppException.conflict(
        'docflow.exchange.not_reviewable',
        'This message is not waiting for a decision',
      );
    }

    await this.audit.logAndWait({
      action: 'docflow.exchange.rejected',
      actorId: actor.id,
      entityType: 'document_exchange',
      entityId: id,
      meta: { reason: input.reason.trim() },
    });
    return this.requireDto(id);
  }

  // --- internals --------------------------------------------------------------------

  private assertRights(actor: AuthUser): void {
    if (hasRegistryAccess(actor)) return;
    throw AppException.forbidden(
      'docflow.exchange.forbidden',
      'Reviewing incoming exchange messages requires chancellery rights',
    );
  }

  private async requireMessage(id: string): Promise<typeof documentExchangeInbound.$inferSelect> {
    const [row] = await this.db
      .select()
      .from(documentExchangeInbound)
      .where(eq(documentExchangeInbound.id, id))
      .limit(1);
    if (!row) throw AppException.notFound('docflow.exchange.not_found', 'Message not found');
    return row;
  }

  private async requireDto(id: string): Promise<InboundExchangeDto> {
    const [row] = await this.db
      .select({
        row: documentExchangeInbound,
        correspondentName: correspondents.name,
        documentRegNumber: documents.regNumber,
      })
      .from(documentExchangeInbound)
      .leftJoin(correspondents, eq(correspondents.id, documentExchangeInbound.correspondentId))
      .leftJoin(documents, eq(documents.id, documentExchangeInbound.documentId))
      .where(eq(documentExchangeInbound.id, id))
      .limit(1);
    if (!row) throw AppException.notFound('docflow.exchange.not_found', 'Message not found');
    const attachments = await this.attachmentsFor([id]);
    return this.toDto(row.row, attachments.get(id) ?? [], {
      correspondentName: row.correspondentName,
      documentRegNumber: row.documentRegNumber,
    });
  }

  /** Attachments with their scan verdicts, in one query for the whole page. */
  private async attachmentsFor(
    ids: string[],
  ): Promise<Map<string, InboundExchangeAttachmentDto[]>> {
    const out = new Map<string, InboundExchangeAttachmentDto[]>();
    if (ids.length === 0) return out;
    const rows = await this.db
      .select({
        inboundId: documentExchangeAttachments.inboundId,
        fileId: documentExchangeAttachments.fileId,
        fileName: documentExchangeAttachments.fileName,
        avStatus: fileVersions.avStatus,
      })
      .from(documentExchangeAttachments)
      .leftJoin(fsNodes, eq(fsNodes.id, documentExchangeAttachments.fileId))
      .leftJoin(fileVersions, eq(fileVersions.id, fsNodes.currentVersionId))
      .where(inArray(documentExchangeAttachments.inboundId, ids))
      .orderBy(desc(documentExchangeAttachments.createdAt));
    for (const row of rows) {
      const list = out.get(row.inboundId) ?? [];
      list.push({ fileId: row.fileId, fileName: row.fileName, avStatus: row.avStatus });
      out.set(row.inboundId, list);
    }
    return out;
  }

  private toDto(
    row: typeof documentExchangeInbound.$inferSelect,
    attachments: InboundExchangeAttachmentDto[],
    joined: { correspondentName: string | null; documentRegNumber: string | null },
  ): InboundExchangeDto {
    // The same rule the register endpoint enforces, so the button the screen shows and the
    // answer the server gives cannot disagree.
    const decision = planPromotion({
      avStatuses: attachments.map((a) => a.avStatus ?? 'pending'),
      correspondentId: row.correspondentId,
      typeCode: row.typeCode,
    });
    const open = row.status === 'received' || row.status === 'quarantined';
    const blocker: 'scan_pending' | 'attachment_infected' | null =
      decision.action === 'wait'
        ? 'scan_pending'
        : decision.action === 'quarantine' && decision.reason === 'attachment_infected'
          ? 'attachment_infected'
          : null;
    return {
      id: row.id,
      adapterId: row.adapterId,
      externalId: row.externalId,
      status: row.status,
      subject: row.subject,
      summary: row.summary,
      senderName: row.senderName,
      senderContact: row.senderContact,
      sentAt: row.sentAt?.toISOString() ?? null,
      receivedAt: row.receivedAt.toISOString(),
      correspondentId: row.correspondentId,
      correspondentName: joined.correspondentName ?? null,
      typeCode: row.typeCode,
      quarantineReason: row.quarantineReason,
      rejectedReason: row.rejectedReason,
      documentId: row.documentId,
      documentRegNumber: joined.documentRegNumber ?? null,
      attachments,
      // A reviewer supplies the correspondent and the type in the form, so an unmatched one is
      // not a blocker — it is the question. An unfinished scan or an infected file IS a
      // blocker, and no answer on the form resolves either.
      canRegister: open && blocker === null,
      blockedBy: open ? blocker : null,
    };
  }
}
