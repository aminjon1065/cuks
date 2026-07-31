import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  documentCollaborators,
  documentLinks,
  documents,
  positions,
  userPositions,
  users,
  type Database,
} from '@cuks/db';
import type { CreateResponseInput, DocumentDetailDto, RouteStepInput } from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { DocumentsService } from './documents.service';
import { RoutesService } from './routes.service';
import { buildResponseRoutePreset } from './response-route-preset';

/** The source-document facts the response inherits. Pure input, so the copy rule is testable. */
export interface ResponseSource {
  id: string;
  docClass: string;
  regNumber: string | null;
  subject: string;
  orgUnitId: string | null;
  correspondentId: string | null;
  senderName: string | null;
  senderContact: string | null;
  confidentiality: 'normal' | 'dsp';
  accessList: string[];
  responseDueAt: Date | null;
}

/** What the response document is created with — derived from the source, never widened. */
export interface ResponseDraft {
  typeCode: string;
  subject: string;
  orgUnitId: string | null;
  correspondentId: string | null;
  recipientName: string | null;
  recipientContact: string | null;
  confidentiality: 'normal' | 'dsp';
  accessList: string[];
  responseDueAt: Date | null;
}

/**
 * What an answer inherits from the letter it answers (plan §5.4).
 *
 * The counterparty's roles swap: whoever SENT the incoming letter is the addressee of the
 * answer. Confidentiality and the allow-list are copied verbatim — never merged with the
 * caller's wishes and never relaxed: an answer quotes the letter, so a less-restricted
 * answer leaks the letter. The reverse (tightening) is left to `setAccess`, which is the
 * one command allowed to move those two columns.
 */
export function planResponseDraft(
  source: ResponseSource,
  input: CreateResponseInput,
): ResponseDraft {
  return {
    typeCode: input.typeCode,
    subject: input.subject?.trim() || `Ответ на ${source.regNumber ?? source.subject}`,
    orgUnitId: input.orgUnitId ?? source.orgUnitId ?? null,
    correspondentId: source.correspondentId,
    recipientName: source.senderName,
    recipientContact: source.senderContact,
    confidentiality: source.confidentiality,
    accessList: [...source.accessList],
    responseDueAt: source.responseDueAt,
  };
}

/**
 * Draft the outgoing answer to an incoming document, in one transaction with its link and
 * its preparer (docs/modules/11 §12.3).
 *
 * Lives outside DocumentsService on purpose: DocumentLinksService and
 * DocumentCollaboratorsService both inject DocumentsService, so putting this in
 * DocumentsService and calling them would close a Nest require cycle. The writes are small
 * and explicit here instead.
 */
@Injectable()
export class DocumentResponsesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly documents: DocumentsService,
    private readonly routes: RoutesService,
    private readonly audit: AuditService,
  ) {}

  async createResponse(
    sourceId: string,
    input: CreateResponseInput,
    actor: AuthUser,
  ): Promise<DocumentDetailDto> {
    const source = await this.documents.assertVisible(sourceId, actor);
    if (source.docClass !== 'incoming' && source.docClass !== 'citizens') {
      throw AppException.unprocessable(
        'docflow.response.source_not_incoming',
        'An answer is prepared for an incoming document',
        { docClass: source.docClass },
      );
    }
    if (!source.regNumber) {
      // The answer cites the letter it answers; an unnumbered draft has nothing to cite.
      throw AppException.unprocessable(
        'docflow.response.source_not_registered',
        'The incoming document must be registered first',
      );
    }

    const draft = planResponseDraft(
      {
        id: source.id,
        docClass: source.docClass,
        regNumber: source.regNumber,
        subject: source.subject,
        orgUnitId: source.orgUnitId,
        correspondentId: source.correspondentId,
        senderName: source.senderName,
        senderContact: source.senderContact,
        confidentiality: source.confidentiality,
        accessList: source.accessList,
        responseDueAt: source.responseDueAt,
      },
      input,
    );

    const responseId = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(documents)
        .values({
          docClass: 'outgoing',
          typeCode: draft.typeCode,
          subject: draft.subject,
          summary: input.summary ?? null,
          orgUnitId: draft.orgUnitId,
          authorId: actor.id,
          createdBy: actor.id,
          confidentiality: draft.confidentiality,
          accessList: draft.accessList,
          correspondentId: draft.correspondentId,
          recipientName: draft.recipientName,
          recipientContact: draft.recipientContact,
          responseDueAt: draft.responseDueAt,
          dueDate: input.dueDate ? new Date(input.dueDate) : null,
          delivery: input.delivery ?? null,
        })
        .returning({ id: documents.id });
      if (!created) throw new Error('Response insert did not return a row');

      // `reply` means «src answers dst», which is exactly this relation — the pair shows on
      // both cards from this single row.
      await tx.insert(documentLinks).values({
        srcDocumentId: created.id,
        dstDocumentId: sourceId,
        kind: 'reply',
        createdBy: actor.id,
      });

      if (input.preparerId && input.preparerId !== actor.id) {
        await tx.insert(documentCollaborators).values({
          documentId: created.id,
          userId: input.preparerId,
          role: 'preparer',
          assignedBy: actor.id,
        });
      }
      return created.id;
    });

    await this.audit.logAndWait({
      action: 'docflow.document.response_created',
      actorId: actor.id,
      entityType: 'document',
      entityId: responseId,
      meta: { sourceId, regNumber: source.regNumber },
    });

    if (input.startRoute) {
      // Outside the transaction on purpose: startRoute opens its own and takes FOR UPDATE
      // on the document row, so calling it from inside would deadlock against ourselves.
      const steps = await this.presetSteps(draft.orgUnitId, input, actor);
      await this.routes.startRoute(responseId, { steps }, actor);
    }
    return this.documents.detail(responseId, actor);
  }

  /**
   * The preset the answer travels: head of the preparing unit → extra approvers → signature.
   *
   * No `register` step is added. Route completion already hands an unnumbered document to
   * the chancellery (`pending_registration`, plan этап 1D), so an explicit register step
   * would only duplicate that — and it would have to name a chancellery org unit that
   * nothing in the model marks as such.
   */
  private async presetSteps(
    orgUnitId: string | null,
    input: CreateResponseInput,
    actor: AuthUser,
  ): Promise<RouteStepInput[]> {
    const headPositionId = orgUnitId
      ? await this.headPositionOf(orgUnitId)
      : await this.headPositionOfActorUnit(actor.id);
    return buildResponseRoutePreset({
      headPositionId,
      approverIds: input.approverIds,
      signerId: input.signerId ?? null,
      registryOrgUnitId: null,
    });
  }

  /** The head position of a unit, or null when the post is vacant. */
  private async headPositionOf(orgUnitId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ id: positions.id })
      .from(positions)
      .where(
        and(
          eq(positions.orgUnitId, orgUnitId),
          eq(positions.isHead, true),
          isNull(positions.deletedAt),
        ),
      )
      .orderBy(asc(positions.rank))
      .limit(1);
    return row?.id ?? null;
  }

  /** Fall back to the author's own unit when the document names none. */
  private async headPositionOfActorUnit(userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ orgUnitId: positions.orgUnitId })
      .from(userPositions)
      .innerJoin(positions, eq(positions.id, userPositions.positionId))
      .innerJoin(users, eq(users.id, userPositions.userId))
      .where(and(eq(userPositions.userId, userId), isNull(positions.deletedAt)))
      .orderBy(asc(positions.rank))
      .limit(1);
    return row?.orgUnitId ? this.headPositionOf(row.orgUnitId) : null;
  }
}
