import { Inject, Injectable } from '@nestjs/common';
import { aliasedTable, and, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  documentDispatches,
  documentFiles,
  documents,
  fileVersions,
  fsNodes,
  users,
  type Database,
} from '@cuks/db';
import {
  wsRooms,
  type CancelDispatchInput,
  type ConfirmDispatchInput,
  type CreateDispatchInput,
  type DispatchChannel,
  type DocumentDispatchDto,
  type FailDispatchInput,
  type WsEventPayloads,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../events/realtime.service';
import { adoptDocumentFile } from './docflow-files.service';
import {
  assertChannelUsable,
  assertDocumentDispatchable,
  assertRetryable,
  planCompletionAfterDispatch,
  planDispatchDecision,
} from './dispatch-policy';
import { assertNoOpenObligations, DocumentsService } from './documents.service';
import { hasChancelleryRights } from './document-visibility';

/** Title given to the scan the chancellery attaches when confirming a send. */
const RECEIPT_TITLE = 'Квитанция об отправке';

/**
 * Recording how a registered outgoing document actually left (docs/modules/11 §12.1,
 * plan §6.8/§7.7).
 *
 * Every attempt is its own row. A retry does not revive the failed row — it opens a new
 * one beside it — so «ушло 12-го, но первая попытка вернулась 10-го» stays true in both
 * halves. The receipt is attached to the document as an ordinary attachment, which puts it
 * behind the same antivirus + visibility gate as the body instead of inventing a second
 * read path for the same bytes.
 */
@Injectable()
export class DispatchesService {
  /**
   * Channels with a working local adapter. Empty by design: CUKS reaches no external
   * service, and an email/integration send only becomes possible when a locally configured
   * adapter registers itself here (docs/02 §1, plan этап 6 «adapter interface без внешней
   * зависимости»). Until then those channels are refused up front rather than accepted and
   * never sent.
   */
  private readonly adapters: DispatchChannel[] = [];

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly documents: DocumentsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
  ) {}

  /** Register a locally configured send adapter (see the field comment). */
  registerAdapter(channel: DispatchChannel): void {
    if (!this.adapters.includes(channel)) this.adapters.push(channel);
  }

  private emitUpdated(
    documentId: string,
    dispatchId: string,
    action: WsEventPayloads['docflow.dispatch.updated']['action'],
    actorId: string | null,
  ): void {
    this.realtime.emitToRoom(wsRooms.entity('document', documentId), 'docflow.dispatch.updated', {
      documentId,
      dispatchId,
      action,
      actorId,
    });
  }

  async list(documentId: string, actor: AuthUser): Promise<DocumentDispatchDto[]> {
    await this.documents.assertVisible(documentId, actor);
    const rows = await this.selectRows(eq(documentDispatches.documentId, documentId));
    return rows.map((r) => this.toDto(r, actor));
  }

  async create(
    documentId: string,
    input: CreateDispatchInput,
    actor: AuthUser,
  ): Promise<DocumentDispatchDto> {
    const doc = await this.documents.assertVisible(documentId, actor);
    assertDocumentDispatchable(doc);
    assertChannelUsable(input.channel, this.adapters);

    const now = new Date();
    const [created] = await this.db
      .insert(documentDispatches)
      .values({
        documentId,
        channel: input.channel,
        status: 'pending',
        recipientName: input.recipientName,
        recipientAddress: input.recipientAddress ?? null,
        recipientContact: input.recipientContact ?? null,
        externalReference: input.externalReference ?? null,
        note: input.note ?? null,
        attemptedAt: now,
        createdBy: actor.id,
      })
      .returning({ id: documentDispatches.id });
    if (!created) throw new Error('Dispatch insert did not return a row');

    await this.audit.logAndWait({
      action: 'docflow.dispatch.created',
      actorId: actor.id,
      entityType: 'document',
      entityId: documentId,
      meta: { dispatchId: created.id, channel: input.channel },
    });
    this.emitUpdated(documentId, created.id, 'created', actor.id);
    return this.requireDto(created.id, actor);
  }

  /**
   * Confirm the send happened. One transaction: the attempt closes, the receipt (if any)
   * is adopted into the document's system space and linked, and the document completes when
   * it owes nothing else — a card that still showed «Зарегистрирован» after the letter went
   * out would keep the chancellery looking for work that no longer exists.
   */
  async confirm(
    id: string,
    input: ConfirmDispatchInput,
    actor: AuthUser,
  ): Promise<DocumentDispatchDto> {
    const dispatch = await this.requireActable(id, actor);
    const now = input.sentAt ? new Date(input.sentAt) : new Date();

    await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(documentDispatches)
        .where(and(eq(documentDispatches.id, id), isNull(documentDispatches.deletedAt)))
        .limit(1)
        .for('update');
      if (!locked) throw AppException.notFound('docflow.dispatch.not_found', 'Dispatch not found');
      const status = planDispatchDecision(locked.status, 'confirm');

      let receiptFileId: string | null = locked.receiptFileId;
      if (input.receiptFileId) {
        // Adopt before linking, exactly like a document body: the receipt is institutional
        // evidence, not a file in the clerk's personal space (docs/modules/11 §12.2).
        await adoptDocumentFile(tx, input.receiptFileId, locked.documentId);
        const [existing] = await tx
          .select({ id: documentFiles.id })
          .from(documentFiles)
          .where(
            and(
              eq(documentFiles.documentId, locked.documentId),
              eq(documentFiles.fileId, input.receiptFileId),
            ),
          )
          .limit(1);
        if (!existing) {
          await tx.insert(documentFiles).values({
            documentId: locked.documentId,
            fileId: input.receiptFileId,
            kind: 'attachment',
            title: RECEIPT_TITLE,
            createdBy: actor.id,
          });
        }
        receiptFileId = input.receiptFileId;
      }

      const [claimed] = await tx
        .update(documentDispatches)
        .set({
          status,
          sentAt: now,
          confirmedBy: actor.id,
          receiptFileId,
          updatedAt: new Date(),
          // Only a non-empty value overwrites: the confirm form always sends the key, and
          // treating its blank default as «clear it» would erase the track number the clerk
          // typed when the attempt was opened.
          ...(input.externalReference?.trim()
            ? { externalReference: input.externalReference.trim() }
            : {}),
          ...(input.note?.trim() ? { note: input.note.trim() } : {}),
        })
        // The old state in the predicate, not a re-read: two clerks confirming at once must
        // not both win, or the second write would move `sent_at` after the fact.
        .where(and(eq(documentDispatches.id, id), eq(documentDispatches.status, 'pending')))
        .returning({ id: documentDispatches.id });
      if (!claimed) {
        throw AppException.conflict(
          'docflow.dispatch.not_pending',
          'This send attempt has already been decided',
        );
      }
      await this.completeIfSettled(tx, locked.documentId);
    });

    await this.audit.logAndWait({
      action: 'docflow.dispatch.sent',
      actorId: actor.id,
      entityType: 'document',
      entityId: dispatch.documentId,
      meta: {
        dispatchId: id,
        channel: dispatch.channel,
        ...(input.externalReference ? { reference: input.externalReference } : {}),
      },
    });
    this.emitUpdated(dispatch.documentId, id, 'sent', actor.id);
    return this.requireDto(id, actor);
  }

  async fail(id: string, input: FailDispatchInput, actor: AuthUser): Promise<DocumentDispatchDto> {
    const dispatch = await this.requireActable(id, actor);
    planDispatchDecision(dispatch.status, 'fail');
    const [claimed] = await this.db
      .update(documentDispatches)
      .set({
        status: 'failed',
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
        updatedAt: new Date(),
      })
      .where(and(eq(documentDispatches.id, id), eq(documentDispatches.status, 'pending')))
      .returning({ id: documentDispatches.id });
    if (!claimed) {
      throw AppException.conflict(
        'docflow.dispatch.not_pending',
        'This send attempt has already been decided',
      );
    }

    await this.audit.logAndWait({
      action: 'docflow.dispatch.failed',
      actorId: actor.id,
      entityType: 'document',
      entityId: dispatch.documentId,
      meta: { dispatchId: id, channel: dispatch.channel, failureCode: input.failureCode },
    });
    // The author has to know their letter did not leave — nobody else is watching this row.
    const [doc] = await this.db
      .select({ authorId: documents.authorId, regNumber: documents.regNumber })
      .from(documents)
      .where(eq(documents.id, dispatch.documentId))
      .limit(1);
    if (doc) {
      void this.notifications.notify({
        userId: doc.authorId,
        type: 'docflow.dispatch.failed',
        title: 'Отправка не состоялась',
        // Never the subject: the document may be ДСП (docs/09 §3).
        body: `Документ ${doc.regNumber ?? ''} не был отправлен: ${input.failureMessage}`.trim(),
        entityType: 'document',
        entityId: dispatch.documentId,
        priority: 'normal',
        emailMode: 'offline',
      });
    }
    this.emitUpdated(dispatch.documentId, id, 'failed', actor.id);
    return this.requireDto(id, actor);
  }

  async cancel(
    id: string,
    input: CancelDispatchInput,
    actor: AuthUser,
  ): Promise<DocumentDispatchDto> {
    const dispatch = await this.requireActable(id, actor);
    planDispatchDecision(dispatch.status, 'cancel');
    const [claimed] = await this.db
      .update(documentDispatches)
      .set({
        status: 'cancelled',
        ...(input.reason ? { failureMessage: input.reason, failureCode: 'cancelled' } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(documentDispatches.id, id), eq(documentDispatches.status, 'pending')))
      .returning({ id: documentDispatches.id });
    if (!claimed) {
      throw AppException.conflict(
        'docflow.dispatch.not_pending',
        'This send attempt has already been decided',
      );
    }
    await this.audit.logAndWait({
      action: 'docflow.dispatch.cancelled',
      actorId: actor.id,
      entityType: 'document',
      entityId: dispatch.documentId,
      meta: { dispatchId: id, channel: dispatch.channel },
    });
    this.emitUpdated(dispatch.documentId, id, 'cancelled', actor.id);
    return this.requireDto(id, actor);
  }

  /**
   * Try again: a NEW pending attempt carrying the same addressee. The spent attempt is left
   * exactly as it was — the history of why the first try failed is the point of keeping it.
   */
  async retry(id: string, actor: AuthUser): Promise<DocumentDispatchDto> {
    const previous = await this.requireActable(id, actor);
    assertRetryable(previous.status);
    const doc = await this.documents.assertVisible(previous.documentId, actor);
    assertDocumentDispatchable(doc);
    assertChannelUsable(previous.channel, this.adapters);

    const [created] = await this.db
      .insert(documentDispatches)
      .values({
        documentId: previous.documentId,
        channel: previous.channel,
        status: 'pending',
        recipientName: previous.recipientName,
        recipientAddress: previous.recipientAddress,
        recipientContact: previous.recipientContact,
        note: previous.note,
        attemptedAt: new Date(),
        createdBy: actor.id,
      })
      .returning({ id: documentDispatches.id });
    if (!created) throw new Error('Dispatch retry did not return a row');

    await this.audit.logAndWait({
      action: 'docflow.dispatch.created',
      actorId: actor.id,
      entityType: 'document',
      entityId: previous.documentId,
      meta: { dispatchId: created.id, channel: previous.channel, retryOf: id },
    });
    this.emitUpdated(previous.documentId, created.id, 'created', actor.id);
    return this.requireDto(created.id, actor);
  }

  /**
   * Close the document once it has been sent and owes nothing else. Uses the same obligation
   * check the manual status command uses, under the caller's transaction — a document with a
   * live instruction or an unread order stays open, sent or not.
   */
  private async completeIfSettled(tx: Database, documentId: string): Promise<void> {
    const [doc] = await tx
      .select({ status: documents.status })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1)
      .for('update');
    if (!doc) return;
    const target = planCompletionAfterDispatch(doc.status);
    if (!target) return;
    const [open] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(documentDispatches)
      .where(
        and(
          eq(documentDispatches.documentId, documentId),
          eq(documentDispatches.status, 'pending'),
          isNull(documentDispatches.deletedAt),
        ),
      );
    // Another attempt is still open — the chancellery is not done with this letter.
    if ((open?.n ?? 0) > 0) return;
    try {
      assertNoOpenObligations(target, await this.openObligations(tx, documentId));
    } catch {
      // Obligations outrank tidiness: leave the document where it is, without failing the
      // send that genuinely happened.
      return;
    }
    await tx.update(documents).set({ status: target }).where(eq(documents.id, documentId));
  }

  /** The same three counts `DocumentsService.changeStatus` reads, inside this transaction. */
  private async openObligations(
    tx: Database,
    documentId: string,
  ): Promise<{
    activeRouteSteps: number;
    activeResolutions: number;
    pendingAcquaintances: number;
  }> {
    return this.documents.openObligationsFor(tx, documentId);
  }

  /** Load an attempt the caller may act on: visible document + chancellery rights. */
  private async requireActable(
    id: string,
    actor: AuthUser,
  ): Promise<typeof documentDispatches.$inferSelect> {
    const [row] = await this.db
      .select()
      .from(documentDispatches)
      .where(and(eq(documentDispatches.id, id), isNull(documentDispatches.deletedAt)))
      .limit(1);
    if (!row) throw AppException.notFound('docflow.dispatch.not_found', 'Dispatch not found');
    // Visibility first: an invisible document must not leak through its dispatch id.
    await this.documents.assertVisible(row.documentId, actor);
    if (!hasChancelleryRights(actor)) {
      throw AppException.forbidden(
        'docflow.dispatch.forbidden',
        'Recording a send requires chancellery rights',
      );
    }
    return row;
  }

  private async requireDto(id: string, actor: AuthUser): Promise<DocumentDispatchDto> {
    const [row] = await this.selectRows(eq(documentDispatches.id, id));
    if (!row) throw AppException.notFound('docflow.dispatch.not_found', 'Dispatch not found');
    return this.toDto(row, actor);
  }

  private async selectRows(where: ReturnType<typeof eq>) {
    const creator = aliasedTable(users, 'dispatch_creator');
    const confirmer = aliasedTable(users, 'dispatch_confirmer');
    return this.db
      .select({
        d: documentDispatches,
        createdByName: creator.shortName,
        confirmedByName: confirmer.shortName,
        receiptName: fsNodes.name,
        receiptSize: fileVersions.size,
        receiptMime: fileVersions.mime,
        receiptAv: fileVersions.avStatus,
      })
      .from(documentDispatches)
      .leftJoin(creator, eq(creator.id, documentDispatches.createdBy))
      .leftJoin(confirmer, eq(confirmer.id, documentDispatches.confirmedBy))
      .leftJoin(fsNodes, eq(fsNodes.id, documentDispatches.receiptFileId))
      .leftJoin(fileVersions, eq(fileVersions.id, fsNodes.currentVersionId))
      .where(and(where, isNull(documentDispatches.deletedAt)))
      .orderBy(desc(documentDispatches.createdAt));
  }

  private toDto(
    row: Awaited<ReturnType<DispatchesService['selectRows']>>[number],
    actor: AuthUser,
  ): DocumentDispatchDto {
    const d = row.d;
    return {
      id: d.id,
      documentId: d.documentId,
      channel: d.channel,
      status: d.status,
      recipientName: d.recipientName,
      recipientAddress: d.recipientAddress,
      recipientContact: d.recipientContact,
      externalReference: d.externalReference,
      note: d.note,
      failureCode: d.failureCode,
      failureMessage: d.failureMessage,
      attemptedAt: d.attemptedAt?.toISOString() ?? null,
      sentAt: d.sentAt?.toISOString() ?? null,
      createdByName: row.createdByName ?? null,
      confirmedByName: row.confirmedByName ?? null,
      receipt:
        d.receiptFileId && row.receiptName
          ? {
              fileId: d.receiptFileId,
              name: row.receiptName,
              size: Number(row.receiptSize ?? 0),
              mime: row.receiptMime ?? null,
              avStatus: row.receiptAv ?? null,
            }
          : null,
      // The same predicate the controller guard uses, so the card never renders a button
      // the API refuses. Only what the attempt still allows is decided client-side, from its
      // own status.
      canAct: hasChancelleryRights(actor),
      createdAt: d.createdAt.toISOString(),
    };
  }
}
