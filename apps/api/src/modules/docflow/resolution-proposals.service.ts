import { Inject, Injectable } from '@nestjs/common';
import { aliasedTable, and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  acquaintanceBatches,
  acquaintances,
  resolutionProposals,
  resolutions,
  users,
  type Database,
} from '@cuks/db';
import {
  wsRooms,
  type AcquaintanceGateDto,
  type ApproveResolutionProposalInput,
  type CreateResolutionProposalInput,
  type RejectResolutionProposalInput,
  type ResolutionProposalDto,
  type UpdateResolutionProposalInput,
  type WsEventPayloads,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB } from '../../common/db/db.module';
import { AppException } from '../../common/exceptions/app.exception';
import { DocumentsService } from './documents.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeService } from '../events/realtime.service';
import { ConfigService } from '../../config/config.service';
import {
  assertProposalEditable,
  canEditProposal,
  planGate,
  planRelease,
  resolveProposalDecider,
} from './resolution-proposals.policy';
import { SubstitutionsService } from './substitutions.service';

/**
 * Draft resolutions awaiting a signer's decision, and the pre-execution reading gate they
 * create (docs/modules/11 §12.11, plan этап 5).
 *
 * The shape of the incoming process: the chancellery drafts an instruction, ONE named
 * signer approves or returns it, and — if the proposal names people who must read the
 * document first — the executors do not see their instruction until everyone has read it
 * or four hours pass. A timeout is not compliance: the readers who never answered are
 * marked `expired`, so no report can present a lapsed deadline as everyone having read it.
 */
@Injectable()
export class ResolutionProposalsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly documents: DocumentsService,
    private readonly substitutions: SubstitutionsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Tell open cards a proposal moved (docs/modules/11 §12.11). Ids and an action only —
   * never the text, which quotes a document that may be ДСП (docs/09 §3); the client
   * refetches through the normal API gate.
   */
  private emitUpdated(
    documentId: string,
    action: WsEventPayloads['docflow.resolution.updated']['action'],
    actorId: string | null,
  ): void {
    this.realtime.emitToRoom(wsRooms.entity('document', documentId), 'docflow.resolution.updated', {
      documentId,
      action,
      actorId,
    });
  }

  async list(documentId: string, actor: AuthUser): Promise<ResolutionProposalDto[]> {
    await this.documents.assertVisible(documentId, actor);
    const rows = await this.db
      .select()
      .from(resolutionProposals)
      .where(
        and(eq(resolutionProposals.documentId, documentId), isNull(resolutionProposals.deletedAt)),
      )
      .orderBy(asc(resolutionProposals.createdAt));
    return Promise.all(rows.map((row) => this.toDto(row, actor)));
  }

  async create(
    documentId: string,
    input: CreateResolutionProposalInput,
    actor: AuthUser,
  ): Promise<ResolutionProposalDto> {
    const doc = await this.documents.assertVisible(documentId, actor);
    if (!doc.regNumber) {
      // A resolution instructs someone about a registered document; issuing one against an
      // unnumbered draft would leave the instruction referring to nothing citable.
      throw AppException.unprocessable(
        'docflow.proposal.document_not_registered',
        'A resolution can only be proposed for a registered document',
      );
    }
    const [created] = await this.db
      .insert(resolutionProposals)
      .values({
        documentId,
        text: input.text,
        signerId: input.signerId,
        resolutionTypeId: input.resolutionTypeId ?? null,
        responsibleExecutorId: input.responsibleExecutorId ?? null,
        coExecutorIds: input.coExecutorIds,
        acquaintUserIds: input.acquaintUserIds,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        isControl: input.isControl,
        proposedBy: actor.id,
      })
      .returning();
    if (!created) throw new Error('Proposal insert did not return a row');
    await this.audit.logAndWait({
      action: 'docflow.resolution_proposal.created',
      actorId: actor.id,
      entityType: 'document',
      entityId: documentId,
      meta: { proposalId: created.id },
    });
    return this.toDto(created, actor);
  }

  async update(
    id: string,
    input: UpdateResolutionProposalInput,
    actor: AuthUser,
  ): Promise<ResolutionProposalDto> {
    const proposal = await this.requireOwnProposal(id, actor);
    assertProposalEditable(proposal.status);
    const [updated] = await this.db
      .update(resolutionProposals)
      .set({
        ...(input.text !== undefined ? { text: input.text } : {}),
        ...(input.signerId !== undefined ? { signerId: input.signerId } : {}),
        ...(input.resolutionTypeId !== undefined
          ? { resolutionTypeId: input.resolutionTypeId ?? null }
          : {}),
        ...(input.responsibleExecutorId !== undefined
          ? { responsibleExecutorId: input.responsibleExecutorId ?? null }
          : {}),
        ...(input.coExecutorIds !== undefined ? { coExecutorIds: input.coExecutorIds } : {}),
        ...(input.acquaintUserIds !== undefined ? { acquaintUserIds: input.acquaintUserIds } : {}),
        ...(input.dueAt !== undefined ? { dueAt: input.dueAt ? new Date(input.dueAt) : null } : {}),
        ...(input.isControl !== undefined ? { isControl: input.isControl } : {}),
      })
      .where(eq(resolutionProposals.id, id))
      .returning();
    if (!updated) throw new Error('Proposal update did not return a row');
    return this.toDto(updated, actor);
  }

  /** Hand the draft to the signer. Idempotent: re-submitting a pending proposal is a no-op. */
  async submit(id: string, actor: AuthUser): Promise<ResolutionProposalDto> {
    const proposal = await this.requireOwnProposal(id, actor);
    assertProposalEditable(proposal.status);
    if (proposal.status === 'pending') return this.toDto(proposal, actor);
    const now = new Date();
    const [updated] = await this.db
      .update(resolutionProposals)
      .set({ status: 'pending', submittedAt: now })
      .where(eq(resolutionProposals.id, id))
      .returning();
    if (!updated) throw new Error('Proposal submit did not return a row');
    await this.audit.logAndWait({
      action: 'docflow.resolution_proposal.submitted',
      actorId: actor.id,
      entityType: 'document',
      entityId: proposal.documentId,
      meta: { proposalId: id, signerId: proposal.signerId },
    });
    void this.notifications.notify({
      userId: proposal.signerId,
      type: 'docflow.resolution_proposal.submitted',
      title: 'Проект резолюции на рассмотрение',
      body: 'Требуется ваше решение по проекту резолюции.',
      entityType: 'document',
      entityId: proposal.documentId,
      priority: 'normal',
      emailMode: 'offline',
    });
    this.emitUpdated(proposal.documentId, 'proposed', actor.id);
    return this.toDto(updated, actor);
  }

  /**
   * Approve: issue the resolution and, if the proposal names readers, shut the gate in
   * front of it — all in ONE transaction, so an instruction can never exist without the
   * gate that was supposed to guard it.
   */
  async approve(
    id: string,
    input: ApproveResolutionProposalInput,
    actor: AuthUser,
  ): Promise<ResolutionProposalDto> {
    const decided = await this.db.transaction(async (tx) => {
      const [proposal] = await tx
        .select()
        .from(resolutionProposals)
        .where(and(eq(resolutionProposals.id, id), isNull(resolutionProposals.deletedAt)))
        .limit(1)
        .for('update');
      if (!proposal) {
        throw AppException.notFound('docflow.proposal.not_found', 'Proposal not found');
      }
      await this.documents.assertVisible(proposal.documentId, actor);
      const { decidedFor } = resolveProposalDecider(proposal, {
        id: actor.id,
        isSuperadmin: actor.isSuperadmin,
        principalIds: await this.substitutions.activePrincipalsFor(actor.id, new Date()),
      });
      if (!proposal.responsibleExecutorId) {
        throw AppException.unprocessable(
          'docflow.proposal.executor_required',
          'A resolution needs a responsible executor',
        );
      }

      const now = new Date();
      const gate = planGate(
        proposal.acquaintUserIds,
        now,
        this.config.all.DOCFLOW_ACQUAINTANCE_GATE_HOURS,
      );
      const [resolution] = await tx
        .insert(resolutions)
        .values({
          documentId: proposal.documentId,
          authorId: proposal.signerId, // the signer owns the instruction, not the drafter
          executorId: proposal.responsibleExecutorId,
          coExecutors: proposal.coExecutorIds,
          text: proposal.text,
          dueDate: proposal.dueAt,
          isControl: proposal.isControl,
          availableAt: gate.availableAt,
        })
        .returning({ id: resolutions.id });
      if (!resolution) throw new Error('Resolution insert did not return an id');

      if (gate.gated) {
        const [batch] = await tx
          .insert(acquaintanceBatches)
          .values({
            documentId: proposal.documentId,
            resolutionId: resolution.id,
            kind: 'pre_execution',
            releaseAt: gate.releaseAt,
            createdBy: actor.id,
          })
          .returning({ id: acquaintanceBatches.id });
        if (!batch) throw new Error('Batch insert did not return an id');
        await tx.insert(acquaintances).values(
          [...new Set(proposal.acquaintUserIds)].map((userId) => ({
            documentId: proposal.documentId,
            userId,
            batchId: batch.id,
            status: 'pending' as const,
            notifiedAt: now,
          })),
        );
      }

      const [updated] = await tx
        .update(resolutionProposals)
        .set({
          status: 'approved',
          decidedBy: actor.id,
          decidedFor,
          decidedAt: now,
          decisionComment: input.comment?.trim() || null,
          resolutionId: resolution.id,
        })
        .where(eq(resolutionProposals.id, id))
        .returning();
      if (!updated) throw new Error('Proposal approve did not return a row');
      return { proposal: updated, gated: gate.gated, decidedFor };
    });

    await this.audit.logAndWait({
      action: 'docflow.resolution_proposal.approved',
      actorId: actor.id,
      entityType: 'document',
      entityId: decided.proposal.documentId,
      meta: {
        proposalId: id,
        resolutionId: decided.proposal.resolutionId ?? '',
        gated: decided.gated,
        ...(decided.decidedFor ? { decidedFor: decided.decidedFor } : {}),
      },
    });
    // Readers are told immediately; executors only once the gate opens.
    for (const userId of decided.proposal.acquaintUserIds) {
      void this.notifications.notify({
        userId,
        type: 'docflow.acquaintance.assigned',
        title: 'Ознакомьтесь с документом',
        body: 'Исполнители получат поручение после вашего ознакомления или по истечении срока.',
        entityType: 'document',
        entityId: decided.proposal.documentId,
        // Critical: the executors are waiting on this reading, so it must not be
        // silenced by a preference.
        priority: 'critical',
        emailMode: 'offline',
      });
    }
    this.emitUpdated(decided.proposal.documentId, 'approved', actor.id);
    if (!decided.gated) await this.notifyExecutors(decided.proposal.id);
    return this.toDto(decided.proposal, actor);
  }

  async reject(
    id: string,
    input: RejectResolutionProposalInput,
    actor: AuthUser,
  ): Promise<ResolutionProposalDto> {
    const proposal = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(resolutionProposals)
        .where(and(eq(resolutionProposals.id, id), isNull(resolutionProposals.deletedAt)))
        .limit(1)
        .for('update');
      if (!row) throw AppException.notFound('docflow.proposal.not_found', 'Proposal not found');
      await this.documents.assertVisible(row.documentId, actor);
      const { decidedFor } = resolveProposalDecider(row, {
        id: actor.id,
        isSuperadmin: actor.isSuperadmin,
        principalIds: await this.substitutions.activePrincipalsFor(actor.id, new Date()),
      });
      const [updated] = await tx
        .update(resolutionProposals)
        .set({
          status: 'rejected',
          decidedBy: actor.id,
          decidedFor,
          decidedAt: new Date(),
          decisionComment: input.comment.trim(),
        })
        .where(eq(resolutionProposals.id, id))
        .returning();
      if (!updated) throw new Error('Proposal reject did not return a row');
      return updated;
    });
    await this.audit.logAndWait({
      action: 'docflow.resolution_proposal.rejected',
      actorId: actor.id,
      entityType: 'document',
      entityId: proposal.documentId,
      meta: { proposalId: id },
    });
    // The drafter has to know what to fix — a rejection without a route back is a dead end.
    void this.notifications.notify({
      userId: proposal.proposedBy,
      type: 'docflow.resolution_proposal.rejected',
      title: 'Проект резолюции возвращён на доработку',
      body: proposal.decisionComment ?? 'Проект возвращён без комментария.',
      entityType: 'document',
      entityId: proposal.documentId,
      priority: 'normal',
      emailMode: 'offline',
    });
    this.emitUpdated(proposal.documentId, 'rejected', actor.id);
    return this.toDto(proposal, actor);
  }

  /**
   * Confirm one reader's line in a pre-execution gate (docs/modules/11 §12.3), then try to
   * open the gate. Separate from the route acknowledgement action because a gate line has
   * no route step behind it — it belongs to a resolution, not to a step.
   *
   * Idempotent: acknowledging twice leaves the line as it was and still re-evaluates the
   * gate, so a double click cannot strand a batch whose last reader already answered.
   */
  async acknowledgeGate(batchId: string, actor: AuthUser): Promise<AcquaintanceGateDto> {
    const [batch] = await this.db
      .select()
      .from(acquaintanceBatches)
      .where(eq(acquaintanceBatches.id, batchId))
      .limit(1);
    if (!batch) throw AppException.notFound('docflow.acquaintance.batch_not_found', 'Not found');
    await this.documents.assertVisible(batch.documentId, actor);

    const now = new Date();
    const [updated] = await this.db
      .update(acquaintances)
      .set({ status: 'acknowledged', acknowledgedAt: now })
      .where(
        and(
          eq(acquaintances.batchId, batchId),
          eq(acquaintances.userId, actor.id),
          eq(acquaintances.status, 'pending'),
        ),
      )
      .returning({ id: acquaintances.id });
    if (updated) {
      await this.audit.logAndWait({
        action: 'docflow.document.acknowledged',
        actorId: actor.id,
        entityType: 'document',
        entityId: batch.documentId,
        meta: { batchId },
      });
    } else {
      // Not on the sheet at all is a different thing from having already answered.
      const [line] = await this.db
        .select({ id: acquaintances.id })
        .from(acquaintances)
        .where(and(eq(acquaintances.batchId, batchId), eq(acquaintances.userId, actor.id)))
        .limit(1);
      if (!line) {
        throw AppException.forbidden(
          'docflow.acquaintance.not_assigned',
          'You are not on this acquaintance sheet',
        );
      }
    }

    this.emitUpdated(batch.documentId, 'acknowledged', actor.id);
    // Always re-evaluate: this may have been the last outstanding reader.
    if (await this.releaseIfDue(batchId, now)) {
      await this.notifyExecutorsForBatch(batchId);
    }
    const gate = await this.gateForBatch(batchId);
    if (!gate) throw new Error('the gate vanished mid-acknowledgement');
    return gate;
  }

  /**
   * Open a gate if it is due (docs/modules/11 §12.3). Called both by the worker sweep and
   * by the last acknowledgement; the two race, and `released_at is null` in the UPDATE
   * predicate is what makes exactly one of them win. The loser's UPDATE matches no row and
   * it simply returns — which is why a double release cannot happen.
   */
  async releaseIfDue(batchId: string, now: Date): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const [batch] = await tx
        .select()
        .from(acquaintanceBatches)
        .where(eq(acquaintanceBatches.id, batchId))
        .limit(1)
        .for('update');
      if (!batch) return false;
      const [pending] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(acquaintances)
        .where(and(eq(acquaintances.batchId, batchId), eq(acquaintances.status, 'pending')));
      const reason = planRelease(batch, pending?.n ?? 0, now);
      if (!reason) return false;

      const [claimed] = await tx
        .update(acquaintanceBatches)
        .set({ releasedAt: now, releasedReason: reason })
        .where(and(eq(acquaintanceBatches.id, batchId), isNull(acquaintanceBatches.releasedAt)))
        .returning({ id: acquaintanceBatches.id });
      if (!claimed) return false; // the other racer won; nothing more to do

      if (reason === 'timeout') {
        // `expired`, never `acknowledged`: a lapsed deadline is not a reading, and a report
        // that conflated them would misstate who actually saw the document.
        await tx
          .update(acquaintances)
          .set({ status: 'expired' })
          .where(and(eq(acquaintances.batchId, batchId), eq(acquaintances.status, 'pending')));
      }
      if (batch.resolutionId) {
        await tx
          .update(resolutions)
          .set({ availableAt: now })
          .where(eq(resolutions.id, batch.resolutionId));
      }
      await this.audit.logWithin(tx, {
        action: 'docflow.acquaintance.released',
        entityType: 'document',
        entityId: batch.documentId,
        meta: { batchId, reason, pendingCount: pending?.n ?? 0 },
      });
      return true;
    });
  }

  /** Tell the executors their instruction is live. */
  private async notifyExecutors(proposalId: string): Promise<void> {
    const [row] = await this.db
      .select({
        documentId: resolutionProposals.documentId,
        executorId: resolutionProposals.responsibleExecutorId,
        coExecutorIds: resolutionProposals.coExecutorIds,
      })
      .from(resolutionProposals)
      .where(eq(resolutionProposals.id, proposalId))
      .limit(1);
    if (!row?.executorId) return;
    for (const userId of new Set([row.executorId, ...row.coExecutorIds])) {
      void this.notifications.notify({
        userId,
        type: 'docflow.resolution.assigned',
        title: 'Новое поручение',
        body: 'Вам назначено поручение по документу.',
        entityType: 'document',
        entityId: row.documentId,
        priority: 'normal',
        emailMode: 'offline',
      });
    }
  }

  private async requireOwnProposal(
    id: string,
    actor: AuthUser,
  ): Promise<typeof resolutionProposals.$inferSelect> {
    const [row] = await this.db
      .select()
      .from(resolutionProposals)
      .where(and(eq(resolutionProposals.id, id), isNull(resolutionProposals.deletedAt)))
      .limit(1);
    if (!row) throw AppException.notFound('docflow.proposal.not_found', 'Proposal not found');
    await this.documents.assertVisible(row.documentId, actor);
    if (row.proposedBy !== actor.id && !actor.isSuperadmin) {
      throw AppException.forbidden(
        'docflow.proposal.not_author',
        'Only the drafter may change this proposal',
      );
    }
    return row;
  }

  private async toDto(
    row: typeof resolutionProposals.$inferSelect,
    actor: AuthUser,
  ): Promise<ResolutionProposalDto> {
    const signer = aliasedTable(users, 'proposal_signer');
    const executor = aliasedTable(users, 'proposal_executor');
    const proposer = aliasedTable(users, 'proposal_proposer');
    const decider = aliasedTable(users, 'proposal_decider');
    const decidedFor = aliasedTable(users, 'proposal_decided_for');
    const [names] = await this.db
      .select({
        signerName: signer.shortName,
        executorName: executor.shortName,
        proposedByName: proposer.shortName,
        decidedByName: decider.shortName,
        decidedForName: decidedFor.shortName,
      })
      .from(resolutionProposals)
      .leftJoin(signer, eq(signer.id, resolutionProposals.signerId))
      .leftJoin(executor, eq(executor.id, resolutionProposals.responsibleExecutorId))
      .leftJoin(proposer, eq(proposer.id, resolutionProposals.proposedBy))
      .leftJoin(decider, eq(decider.id, resolutionProposals.decidedBy))
      .leftJoin(decidedFor, eq(decidedFor.id, resolutionProposals.decidedFor))
      .where(eq(resolutionProposals.id, row.id))
      .limit(1);

    const principalIds = await this.substitutions.activePrincipalsFor(actor.id, new Date());
    const canDecide =
      row.status === 'pending' &&
      (actor.id === row.signerId || principalIds.includes(row.signerId) || actor.isSuperadmin);
    const canEdit = canEditProposal(row, { id: actor.id, isSuperadmin: actor.isSuperadmin });

    return {
      id: row.id,
      documentId: row.documentId,
      text: row.text,
      status: row.status,
      signerId: row.signerId,
      signerName: names?.signerName ?? null,
      resolutionTypeId: row.resolutionTypeId,
      responsibleExecutorId: row.responsibleExecutorId,
      responsibleExecutorName: names?.executorName ?? null,
      coExecutorIds: row.coExecutorIds,
      acquaintUserIds: row.acquaintUserIds,
      dueAt: row.dueAt?.toISOString() ?? null,
      isControl: row.isControl,
      proposedByName: names?.proposedByName ?? null,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      decidedByName: names?.decidedByName ?? null,
      decidedForName: names?.decidedForName ?? null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decisionComment: row.decisionComment,
      resolutionId: row.resolutionId,
      canDecide,
      canEdit,
      gate: await this.gateFor(row.resolutionId),
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Every batch whose timeout has come and which nobody has released — the worker sweep. */
  async dueBatchIds(now: Date, limit = 200): Promise<string[]> {
    const rows = await this.db
      .select({ id: acquaintanceBatches.id })
      .from(acquaintanceBatches)
      .where(
        and(
          isNull(acquaintanceBatches.releasedAt),
          sql`${acquaintanceBatches.releaseAt} is not null and ${acquaintanceBatches.releaseAt} <= ${now}`,
        ),
      )
      .limit(limit);
    return rows.map((r) => r.id);
  }

  /**
   * Tell the executors of the resolution a just-opened gate was guarding — and their open
   * screens too. The realtime event goes to each executor's own `user:{id}` room, not only
   * to the document room: until this moment they could not see the document, so they cannot
   * have been in its room, and «Мои задачи» would otherwise show the instruction only after
   * a reload.
   */
  async notifyExecutorsForBatch(batchId: string): Promise<void> {
    const [row] = await this.db
      .select({
        documentId: acquaintanceBatches.documentId,
        executorId: resolutions.executorId,
        coExecutors: resolutions.coExecutors,
      })
      .from(acquaintanceBatches)
      .innerJoin(resolutions, eq(resolutions.id, acquaintanceBatches.resolutionId))
      .where(eq(acquaintanceBatches.id, batchId))
      .limit(1);
    if (!row) return;
    for (const userId of new Set([row.executorId, ...row.coExecutors])) {
      void this.notifications.notify({
        userId,
        type: 'docflow.resolution.assigned',
        title: 'Новое поручение',
        body: 'Вам назначено поручение по документу.',
        entityType: 'document',
        entityId: row.documentId,
        priority: 'normal',
        emailMode: 'offline',
      });
      this.realtime.emitToUser(userId, 'docflow.resolution.updated', {
        documentId: row.documentId,
        action: 'released',
        actorId: null,
      });
    }
    this.emitUpdated(row.documentId, 'released', null);
  }

  private async gateFor(resolutionId: string | null): Promise<AcquaintanceGateDto | null> {
    if (!resolutionId) return null;
    const [batch] = await this.db
      .select({ id: acquaintanceBatches.id })
      .from(acquaintanceBatches)
      .where(eq(acquaintanceBatches.resolutionId, resolutionId))
      .limit(1);
    if (!batch) return null;
    return this.gateForBatch(batch.id);
  }

  private async gateForBatch(batchId: string): Promise<AcquaintanceGateDto | null> {
    const [batch] = await this.db
      .select()
      .from(acquaintanceBatches)
      .where(eq(acquaintanceBatches.id, batchId))
      .limit(1);
    if (!batch) return null;
    const lines = await this.db
      .select({
        userId: acquaintances.userId,
        userName: users.shortName,
        status: acquaintances.status,
        acknowledgedAt: acquaintances.acknowledgedAt,
      })
      .from(acquaintances)
      .leftJoin(users, eq(users.id, acquaintances.userId))
      .where(eq(acquaintances.batchId, batch.id))
      .orderBy(asc(acquaintances.createdAt));
    return {
      id: batch.id,
      releaseAt: batch.releaseAt?.toISOString() ?? null,
      releasedAt: batch.releasedAt?.toISOString() ?? null,
      releasedReason: batch.releasedReason,
      lines: lines.map((l) => ({
        userId: l.userId,
        userName: l.userName ?? null,
        status: l.status,
        acknowledgedAt: l.acknowledgedAt?.toISOString() ?? null,
      })),
    };
  }
}
