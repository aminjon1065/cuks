import { Inject, Injectable } from '@nestjs/common';
import { aliasedTable, and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import {
  archiveDispositionBatches,
  archiveDispositionItems,
  documents,
  nomenclature,
  users,
  type Database,
} from '@cuks/db';
import type {
  ArchiveDocumentInput,
  DispositionStatus,
  ArchiveEntryDto,
  ArchiveQuery,
  CreateDispositionBatchInput,
  DispositionBatchDto,
  DispositionDecisionInput,
  DispositionItemsInput,
  DocumentDetailDto,
  LegalHoldInput,
  PaginatedResult,
  RestoreDocumentInput,
} from '@cuks/shared';
import { buildXlsx, type XlsxRow } from '@cuks/shared/office/xlsx';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import {
  assertArchivable,
  assertDisposable,
  assertNotLegalHeld,
  assertRestorable,
  assertSeparateReviewer,
  planBatchTransition,
  planRetention,
} from './archive-policy';
import { assertNoOpenObligations, DocumentsService } from './documents.service';
import { hasConfidentialAccess, hasRegistryAccess } from './document-visibility';

/**
 * The archive: filing documents away, holding them, and disposing of them under an act
 * (docs/modules/11 §12.12, plan §6.9/§7.8).
 *
 * The shape of the whole thing is one rule: **a document cannot be lost by accident**. A
 * machine may only mark a candidate; a person archives, holds, assembles an act, a SECOND
 * person approves it, and only then may it be executed — and «executed» means the record is
 * closed, not that bytes were deleted. Nothing here removes an object from storage; that
 * waits for an approved retention policy (docs/09 §6).
 */
const ARCHIVE_ORG_NAME = 'Комитет по чрезвычайным ситуациям и гражданской обороне';
const ARCHIVE_TITLE = 'Опись архивных документов';
/** Russian labels for the опись; `executed` must read as the disposal it records. */
const ARCHIVE_DISPOSITION_LABELS: Record<DispositionStatus, string> = {
  none: '',
  candidate: 'Кандидат',
  pending: 'В акте',
  approved: 'Акт утверждён',
  rejected: 'Возвращён',
  executed: 'Выбыл',
};

@Injectable()
export class ArchiveService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * File the document into its case, freezing the retention term the case states today.
   *
   * One transaction with the status change and the obligation check the manual command uses,
   * so a document can never be «в архиве» while it still owes a reading or an instruction.
   */
  async archive(
    id: string,
    input: ArchiveDocumentInput,
    actor: AuthUser,
  ): Promise<DocumentDetailDto> {
    if (!hasRegistryAccess(actor)) {
      throw AppException.forbidden(
        'docflow.archive.forbidden',
        'Filing a document into a case requires registry rights',
      );
    }
    const snapshotMeta = await this.db.transaction(async (tx) => {
      const doc = await this.lock(tx, id, actor);
      assertArchivable(doc);
      const caseIndex = input.caseIndex ?? doc.caseIndex;
      const rule = caseIndex ? await this.retentionRuleFor(tx, caseIndex) : null;
      const now = new Date();
      const snapshot = planRetention(rule, now);

      // The obligations gate is the same one `changeStatus` uses — archiving is a closing
      // status, and a closed card with live work underneath it is exactly what it prevents.
      assertNoOpenObligations('archived', await this.documents.openObligationsFor(tx, id));

      await tx
        .update(documents)
        .set({
          status: 'archived',
          archivedAt: now,
          archivedBy: actor.id,
          caseIndex: caseIndex ?? null,
          retentionUntil: snapshot.retentionUntil,
          retentionMonths: snapshot.retentionMonths,
          isPermanent: snapshot.isPermanent,
        })
        .where(eq(documents.id, id));
      return { caseIndex, snapshot };
    });

    await this.audit.logAndWait({
      action: 'docflow.archive.archived',
      actorId: actor.id,
      entityType: 'document',
      entityId: id,
      meta: {
        caseIndex: snapshotMeta.caseIndex ?? '',
        retentionUntil: snapshotMeta.snapshot.retentionUntil?.toISOString() ?? '',
        retentionMonths: snapshotMeta.snapshot.retentionMonths ?? 0,
        isPermanent: snapshotMeta.snapshot.isPermanent,
        ...(input.note ? { reason: input.note } : {}),
      },
    });
    return this.documents.detail(id, actor);
  }

  /**
   * Take a document back out of the archive, always with a reason. The retention snapshot is
   * cleared with it: when the document is filed again the term is read afresh, because it is
   * being filed afresh — carrying a stale deadline forward would date it from a filing that
   * was undone.
   */
  async restore(
    id: string,
    input: RestoreDocumentInput,
    actor: AuthUser,
  ): Promise<DocumentDetailDto> {
    if (!hasRegistryAccess(actor)) {
      throw AppException.forbidden(
        'docflow.archive.forbidden',
        'Taking a document out of the archive requires registry rights',
      );
    }
    await this.db.transaction(async (tx) => {
      const doc = await this.lock(tx, id, actor);
      assertRestorable(doc);
      await tx
        .update(documents)
        .set({
          status: 'completed',
          archivedAt: null,
          archivedBy: null,
          retentionUntil: null,
          retentionMonths: null,
          isPermanent: false,
          dispositionStatus: 'none',
        })
        .where(eq(documents.id, id));
    });
    await this.audit.logAndWait({
      action: 'docflow.archive.restored',
      actorId: actor.id,
      entityType: 'document',
      entityId: id,
      meta: { reason: input.reason },
    });
    return this.documents.detail(id, actor);
  }

  /** Set a legal hold. Its own permission: a hold is a legal instruction, not registry work. */
  async setLegalHold(
    id: string,
    input: LegalHoldInput,
    actor: AuthUser,
  ): Promise<DocumentDetailDto> {
    this.assertHoldRights(actor);
    await this.db.transaction(async (tx) => {
      await this.lock(tx, id, actor);
      await tx
        .update(documents)
        .set({
          legalHold: true,
          legalHoldReason: input.reason,
          legalHoldAt: new Date(),
          legalHoldBy: actor.id,
          // A held document leaves the candidate list at once — the sweep would skip it
          // anyway, but leaving a stale «кандидат» beside a hold reads as a contradiction.
          dispositionStatus: sql`case when ${documents.dispositionStatus} = 'candidate' then 'none' else ${documents.dispositionStatus} end`,
        })
        .where(eq(documents.id, id));
    });
    await this.audit.logAndWait({
      action: 'docflow.archive.legal_hold_set',
      actorId: actor.id,
      entityType: 'document',
      entityId: id,
      meta: { reason: input.reason },
    });
    return this.documents.detail(id, actor);
  }

  /** Lift the hold — also with a reason, so the record explains both directions. */
  async clearLegalHold(
    id: string,
    input: LegalHoldInput,
    actor: AuthUser,
  ): Promise<DocumentDetailDto> {
    this.assertHoldRights(actor);
    await this.db.transaction(async (tx) => {
      const doc = await this.lock(tx, id, actor);
      if (!doc.legalHold) {
        throw AppException.conflict('docflow.archive.no_legal_hold', 'No legal hold is set');
      }
      await tx
        .update(documents)
        .set({ legalHold: false, legalHoldReason: null, legalHoldAt: null, legalHoldBy: null })
        .where(eq(documents.id, id));
    });
    await this.audit.logAndWait({
      action: 'docflow.archive.legal_hold_cleared',
      actorId: actor.id,
      entityType: 'document',
      entityId: id,
      meta: { reason: input.reason },
    });
    return this.documents.detail(id, actor);
  }

  /**
   * The archive list — «опись». Row visibility is the same rule the document list applies:
   * ДСП never appears for somebody the allow-list did not admit, whatever the archive right
   * says.
   */
  async list(query: ArchiveQuery, actor: AuthUser): Promise<PaginatedResult<ArchiveEntryDto>> {
    if (!hasRegistryAccess(actor)) {
      throw AppException.forbidden(
        'docflow.archive.forbidden',
        'The archive requires registry rights',
      );
    }
    const archivedBy = aliasedTable(users, 'archive_archived_by');
    const where = [isNull(documents.deletedAt), sql`${documents.archivedAt} is not null`];
    if (query.caseIndex) where.push(eq(documents.caseIndex, query.caseIndex));
    if (query.search) {
      const q = `%${query.search}%`;
      const match = or(ilike(documents.subject, q), ilike(documents.regNumber, q));
      if (match) where.push(match);
    }
    if (query.candidatesOnly) where.push(eq(documents.dispositionStatus, 'candidate'));
    if (query.legalHoldOnly) where.push(eq(documents.legalHold, true));
    // The same ДСП guard the document list applies, restated here rather than trusted from
    // elsewhere: an «опись» that leaked a ДСП subject would leak it in an exportable form.
    if (!actor.isSuperadmin) {
      const notDsp = ne(documents.confidentiality, 'dsp');
      const visible = hasConfidentialAccess(actor)
        ? or(
            notDsp,
            eq(documents.authorId, actor.id),
            sql`${actor.id}::uuid = any(${documents.accessList})`,
          )
        : or(notDsp, eq(documents.authorId, actor.id));
      if (visible) where.push(visible);
    }

    const offset = (query.page - 1) * query.limit;
    const [rows, totalRows] = await Promise.all([
      this.db
        .select({
          documentId: documents.id,
          regNumber: documents.regNumber,
          subject: documents.subject,
          docClass: documents.docClass,
          caseIndex: documents.caseIndex,
          caseTitle: nomenclature.title,
          archivedAt: documents.archivedAt,
          archivedByName: archivedBy.shortName,
          retentionUntil: documents.retentionUntil,
          retentionMonths: documents.retentionMonths,
          isPermanent: documents.isPermanent,
          legalHold: documents.legalHold,
          legalHoldReason: documents.legalHoldReason,
          dispositionStatus: documents.dispositionStatus,
          confidentiality: documents.confidentiality,
        })
        .from(documents)
        .leftJoin(archivedBy, eq(archivedBy.id, documents.archivedBy))
        .leftJoin(
          nomenclature,
          and(eq(nomenclature.index, documents.caseIndex), isNull(nomenclature.deletedAt)),
        )
        .where(and(...where))
        .orderBy(desc(documents.archivedAt))
        .limit(query.limit)
        .offset(offset),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(documents)
        .where(and(...where)),
    ]);

    return {
      items: rows.map((r) => ({
        documentId: r.documentId,
        regNumber: r.regNumber,
        subject: r.subject,
        docClass: r.docClass,
        caseIndex: r.caseIndex,
        caseTitle: r.caseTitle ?? null,
        archivedAt: r.archivedAt?.toISOString() ?? null,
        archivedByName: r.archivedByName ?? null,
        retentionUntil: r.retentionUntil?.toISOString() ?? null,
        retentionMonths: r.retentionMonths,
        isPermanent: r.isPermanent,
        legalHold: r.legalHold,
        legalHoldReason: r.legalHoldReason,
        dispositionStatus: r.dispositionStatus,
        confidentiality: r.confidentiality,
      })),
      total: totalRows[0]?.n ?? 0,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * The inventory as an XLSX «опись» — over exactly the rows the caller may see, because it
   * reuses `list()` rather than querying again. An export that widened the visibility of the
   * screen it came from would be the easiest ДСП leak in the product.
   */
  async inventoryXlsx(query: ArchiveQuery, actor: AuthUser): Promise<Buffer> {
    const page = await this.list({ ...query, page: 1, limit: 200 }, actor);
    const header: XlsxRow = [
      'Номер',
      'Документ',
      'Дело',
      'Сдан в дело',
      'Срок хранения',
      'Запрет',
      'Выбытие',
    ];
    const rows: XlsxRow[] = [[ARCHIVE_ORG_NAME], [ARCHIVE_TITLE], [], header];
    for (const e of page.items) {
      rows.push([
        e.regNumber ?? '—',
        e.subject,
        e.caseIndex ? `${e.caseIndex} ${e.caseTitle ?? ''}`.trim() : '—',
        e.archivedAt ? e.archivedAt.slice(0, 10) : '—',
        e.isPermanent ? 'Постоянно' : (e.retentionUntil?.slice(0, 10) ?? 'не установлен'),
        e.legalHold ? (e.legalHoldReason ?? 'да') : '',
        ARCHIVE_DISPOSITION_LABELS[e.dispositionStatus],
      ]);
    }
    rows.push([]);
    rows.push([`Всего в описи: ${page.total}`]);
    if (page.total > page.items.length) {
      // Said plainly rather than silently truncated: an опись that looks complete and is not
      // is worse than one that admits its own limit.
      rows.push([`Выгружено первых ${page.items.length} записей — уточните фильтр`]);
    }
    return Buffer.from(buildXlsx(rows, 'Опись'));
  }
  // --- Acts of disposal -------------------------------------------------------------

  async listBatches(actor: AuthUser): Promise<DispositionBatchDto[]> {
    this.assertDisposeRights(actor);
    const rows = await this.db
      .select()
      .from(archiveDispositionBatches)
      .where(isNull(archiveDispositionBatches.deletedAt))
      .orderBy(desc(archiveDispositionBatches.createdAt));
    return Promise.all(rows.map((b) => this.batchDto(b, actor)));
  }

  async createBatch(
    input: CreateDispositionBatchInput,
    actor: AuthUser,
  ): Promise<DispositionBatchDto> {
    this.assertDisposeRights(actor);
    const [created] = await this.db
      .insert(archiveDispositionBatches)
      .values({ number: input.number, reason: input.reason, createdBy: actor.id })
      .returning();
    if (!created) throw new Error('Disposition batch insert did not return a row');
    if (input.documentIds.length > 0) {
      await this.addItems(created.id, { documentIds: input.documentIds }, actor);
    }
    await this.audit.logAndWait({
      action: 'docflow.disposition.created',
      actorId: actor.id,
      entityType: 'disposition_batch',
      entityId: created.id,
      meta: { number: input.number, documents: input.documentIds.length },
    });
    return this.requireBatchDto(created.id, actor);
  }

  /**
   * Add documents to a draft act. Every one is checked against the disposal policy HERE, not
   * only at execution: an act assembled out of documents that may not be disposed of would
   * be approved by somebody reading a list that quietly cannot be carried out.
   */
  async addItems(
    batchId: string,
    input: DispositionItemsInput,
    actor: AuthUser,
  ): Promise<DispositionBatchDto> {
    this.assertDisposeRights(actor);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const batch = await this.lockBatch(tx, batchId);
      if (batch.status !== 'draft') {
        throw AppException.conflict(
          'docflow.disposition.not_draft',
          'Only a draft act can be changed',
          { status: batch.status },
        );
      }
      const rows = await tx
        .select()
        .from(documents)
        .where(and(inArray(documents.id, input.documentIds), isNull(documents.deletedAt)));
      if (rows.length !== input.documentIds.length) {
        throw AppException.notFound('docflow.document.not_found', 'Document not found');
      }
      for (const doc of rows) assertDisposable(doc, now);

      await tx
        .insert(archiveDispositionItems)
        .values(rows.map((d) => ({ batchId, documentId: d.id })))
        .onConflictDoNothing();
      await tx
        .update(documents)
        .set({ dispositionStatus: 'pending' })
        .where(inArray(documents.id, input.documentIds));
    });
    return this.requireBatchDto(batchId, actor);
  }

  /** Hand the act to a reviewer. */
  async submitBatch(batchId: string, actor: AuthUser): Promise<DispositionBatchDto> {
    this.assertDisposeRights(actor);
    await this.db.transaction(async (tx) => {
      const batch = await this.lockBatch(tx, batchId);
      const status = planBatchTransition(batch.status, 'submit');
      const [items] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(archiveDispositionItems)
        .where(eq(archiveDispositionItems.batchId, batchId));
      if ((items?.n ?? 0) === 0) {
        throw AppException.unprocessable(
          'docflow.disposition.empty',
          'An act of disposal with no documents decides nothing',
        );
      }
      await tx
        .update(archiveDispositionBatches)
        .set({ status, submittedAt: new Date(), updatedAt: new Date() })
        .where(eq(archiveDispositionBatches.id, batchId));
    });
    await this.audit.logAndWait({
      action: 'docflow.disposition.submitted',
      actorId: actor.id,
      entityType: 'disposition_batch',
      entityId: batchId,
    });
    return this.requireBatchDto(batchId, actor);
  }

  /** Approve or reject — never by the person who assembled the act. */
  async decideBatch(
    batchId: string,
    action: 'approve' | 'reject',
    input: DispositionDecisionInput,
    actor: AuthUser,
  ): Promise<DispositionBatchDto> {
    this.assertDisposeRights(actor);
    await this.db.transaction(async (tx) => {
      const batch = await this.lockBatch(tx, batchId);
      assertSeparateReviewer(batch.createdBy, actor.id);
      const status = planBatchTransition(batch.status, action);
      await tx
        .update(archiveDispositionBatches)
        .set({
          status,
          approvedBy: actor.id,
          decidedAt: new Date(),
          decisionComment: input.comment?.trim() || null,
          updatedAt: new Date(),
        })
        .where(eq(archiveDispositionBatches.id, batchId));
      if (action === 'reject') {
        // The documents go back to being ordinary archived records — a rejected act must not
        // leave them looking half-disposed.
        await this.setItemDocuments(tx, batchId, 'none');
      } else {
        await this.setItemDocuments(tx, batchId, 'approved');
      }
    });
    await this.audit.logAndWait({
      action: `docflow.disposition.${action === 'approve' ? 'approved' : 'rejected'}`,
      actorId: actor.id,
      entityType: 'disposition_batch',
      entityId: batchId,
      ...(input.comment ? { meta: { reason: input.comment } } : {}),
    });
    return this.requireBatchDto(batchId, actor);
  }

  /**
   * Carry out an approved act — LOGICALLY. The documents are marked disposed and stay
   * readable; nothing is deleted from storage, and no code path in this release can. A legal
   * hold set between approval and execution still stops the document here, which is the whole
   * point of checking it at every step rather than once.
   */
  async executeBatch(batchId: string, actor: AuthUser): Promise<DispositionBatchDto> {
    this.assertDisposeRights(actor);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const batch = await this.lockBatch(tx, batchId);
      const status = planBatchTransition(batch.status, 'execute');
      const rows = await tx
        .select({ doc: documents })
        .from(archiveDispositionItems)
        .innerJoin(documents, eq(documents.id, archiveDispositionItems.documentId))
        .where(
          and(
            eq(archiveDispositionItems.batchId, batchId),
            ne(archiveDispositionItems.decision, 'keep'),
          ),
        );
      for (const r of rows) assertNotLegalHeld(r.doc, 'execute');

      const ids = rows.map((r) => r.doc.id);
      if (ids.length > 0) {
        await tx
          .update(documents)
          .set({ dispositionStatus: 'executed', disposedAt: now, disposedBy: actor.id })
          .where(inArray(documents.id, ids));
      }
      await tx
        .update(archiveDispositionBatches)
        .set({ status, executedAt: now, updatedAt: now })
        .where(eq(archiveDispositionBatches.id, batchId));
      // Inside the transaction: an act that says documents were disposed of, with no audit
      // record of it, is the one outcome an archive must never produce.
      await this.audit.logWithin(tx, {
        action: 'docflow.disposition.executed',
        actorId: actor.id,
        entityType: 'disposition_batch',
        entityId: batchId,
        meta: { documents: ids.length, number: batch.number, logical: true },
      });
    });
    return this.requireBatchDto(batchId, actor);
  }

  // --- internals --------------------------------------------------------------------

  private assertHoldRights(actor: AuthUser): void {
    if (actor.isSuperadmin || actor.permissions.includes('docflow.archive.hold')) return;
    throw AppException.forbidden(
      'docflow.archive.hold_forbidden',
      'Setting a legal hold requires the archive-hold right',
    );
  }

  private assertDisposeRights(actor: AuthUser): void {
    if (actor.isSuperadmin || actor.permissions.includes('docflow.archive.dispose')) return;
    throw AppException.forbidden(
      'docflow.archive.dispose_forbidden',
      'Acts of disposal require the archive-dispose right',
    );
  }

  /** Lock the document row and prove the caller may see it at all. */
  private async lock(
    tx: Database,
    id: string,
    actor: AuthUser,
  ): Promise<typeof documents.$inferSelect> {
    const [row] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, id), isNull(documents.deletedAt)))
      .limit(1)
      .for('update');
    if (!row) throw AppException.notFound('docflow.document.not_found', 'Document not found');
    // Visibility first and by the same rule as everywhere else — an archive right is not a
    // ДСП clearance.
    await this.documents.assertVisible(id, actor);
    return row;
  }

  private async lockBatch(
    tx: Database,
    batchId: string,
  ): Promise<typeof archiveDispositionBatches.$inferSelect> {
    const [row] = await tx
      .select()
      .from(archiveDispositionBatches)
      .where(
        and(eq(archiveDispositionBatches.id, batchId), isNull(archiveDispositionBatches.deletedAt)),
      )
      .limit(1)
      .for('update');
    if (!row) throw AppException.notFound('docflow.disposition.not_found', 'Act not found');
    return row;
  }

  private async setItemDocuments(
    tx: Database,
    batchId: string,
    status: 'none' | 'approved',
  ): Promise<void> {
    const items = await tx
      .select({ documentId: archiveDispositionItems.documentId })
      .from(archiveDispositionItems)
      .where(eq(archiveDispositionItems.batchId, batchId));
    if (items.length === 0) return;
    await tx
      .update(documents)
      .set({ dispositionStatus: status })
      .where(
        inArray(
          documents.id,
          items.map((i) => i.documentId),
        ),
      );
  }

  /** The case rule for an index, or null when the case is unknown or states no term. */
  private async retentionRuleFor(
    tx: Database,
    caseIndex: string,
  ): Promise<{ retentionMonths: number | null; isPermanent: boolean } | null> {
    const [row] = await tx
      .select({
        retentionMonths: nomenclature.retentionMonths,
        isPermanent: nomenclature.isPermanent,
      })
      .from(nomenclature)
      .where(and(eq(nomenclature.index, caseIndex), isNull(nomenclature.deletedAt)))
      .limit(1);
    return row ?? null;
  }

  private async requireBatchDto(id: string, actor: AuthUser): Promise<DispositionBatchDto> {
    const [row] = await this.db
      .select()
      .from(archiveDispositionBatches)
      .where(eq(archiveDispositionBatches.id, id))
      .limit(1);
    if (!row) throw AppException.notFound('docflow.disposition.not_found', 'Act not found');
    return this.batchDto(row, actor);
  }

  private async batchDto(
    batch: typeof archiveDispositionBatches.$inferSelect,
    actor: AuthUser,
  ): Promise<DispositionBatchDto> {
    const creator = aliasedTable(users, 'batch_creator');
    const approver = aliasedTable(users, 'batch_approver');
    const [names] = await this.db
      .select({ createdByName: creator.shortName, approvedByName: approver.shortName })
      .from(archiveDispositionBatches)
      .leftJoin(creator, eq(creator.id, archiveDispositionBatches.createdBy))
      .leftJoin(approver, eq(approver.id, archiveDispositionBatches.approvedBy))
      .where(eq(archiveDispositionBatches.id, batch.id))
      .limit(1);

    const items = await this.db
      .select({
        documentId: archiveDispositionItems.documentId,
        regNumber: documents.regNumber,
        subject: documents.subject,
        caseIndex: documents.caseIndex,
        retentionUntil: documents.retentionUntil,
        legalHold: documents.legalHold,
        decision: archiveDispositionItems.decision,
        comment: archiveDispositionItems.comment,
      })
      .from(archiveDispositionItems)
      .innerJoin(documents, eq(documents.id, archiveDispositionItems.documentId))
      .where(eq(archiveDispositionItems.batchId, batch.id))
      .orderBy(asc(archiveDispositionItems.createdAt));

    return {
      id: batch.id,
      number: batch.number,
      status: batch.status,
      reason: batch.reason,
      decisionComment: batch.decisionComment,
      createdByName: names?.createdByName ?? null,
      approvedByName: names?.approvedByName ?? null,
      submittedAt: batch.submittedAt?.toISOString() ?? null,
      decidedAt: batch.decidedAt?.toISOString() ?? null,
      executedAt: batch.executedAt?.toISOString() ?? null,
      createdAt: batch.createdAt.toISOString(),
      items: items.map((i) => ({
        documentId: i.documentId,
        regNumber: i.regNumber,
        subject: i.subject,
        caseIndex: i.caseIndex,
        retentionUntil: i.retentionUntil?.toISOString() ?? null,
        legalHold: i.legalHold,
        decision: i.decision,
        comment: i.comment,
      })),
      // The author of an act never reviews it, so the card never offers them the button.
      canDecide: batch.status === 'pending' && batch.createdBy !== actor.id,
    };
  }
}
