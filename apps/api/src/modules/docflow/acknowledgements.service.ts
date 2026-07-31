import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import {
  acquaintanceBatches,
  acquaintances,
  documents,
  positions,
  routeSteps,
  routes,
  userPositions,
  users,
  type Database,
} from '@cuks/db';
import type { AcknowledgementSheetDto, AcquaintanceDto } from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { canViewDocumentBase } from './document-visibility';
import { RoutesService } from './routes.service';

/**
 * Acknowledgements / ознакомление (docs/modules/11 §3/§6, task 3.6). An acknowledge route
 * step expands (in RoutesService) into an acquaintance sheet; here each employee records
 * their reading, and the step completes once everyone has. The sheet is visible in the
 * card, and the «На ознакомление» queue lists pending documents.
 */
@Injectable()
export class AcknowledgementsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly routes: RoutesService,
  ) {}

  /** Record the caller's acknowledgement on a step; when everyone has acknowledged, the
   *  step completes and the route advances. */
  async acknowledge(stepId: string, actor: AuthUser): Promise<AcknowledgementSheetDto> {
    const documentId = await this.db.transaction(async (tx) => {
      const [step] = await tx.select().from(routeSteps).where(eq(routeSteps.id, stepId)).limit(1);
      if (!step) {
        throw AppException.notFound('docflow.route_step.not_found', 'Route step not found');
      }
      // Lock the route so "everyone acknowledged?" + completion is serialized.
      const [route] = await tx
        .select()
        .from(routes)
        .where(eq(routes.id, step.routeId))
        .limit(1)
        .for('update');
      if (!route || route.status !== 'active') {
        throw AppException.conflict('docflow.route.not_active', 'The route is not active');
      }
      if (step.kind !== 'acknowledge' || step.status !== 'active') {
        throw AppException.conflict(
          'docflow.acknowledge.not_active',
          'This is not an active acknowledgement step',
        );
      }
      const [mine] = await tx
        .select()
        .from(acquaintances)
        .where(and(eq(acquaintances.routeStepId, stepId), eq(acquaintances.userId, actor.id)))
        .limit(1);
      if (!mine) {
        throw AppException.forbidden(
          'docflow.acknowledge.not_assigned',
          'You are not on this acknowledgement sheet',
        );
      }
      if (!mine.acknowledgedAt) {
        // `status` as well as the timestamp: the gate and distribution paths read `status`,
        // and a route line that stayed `pending` forever made the same fact read two
        // different ways depending on which query asked (plan этап 7).
        await tx
          .update(acquaintances)
          .set({ acknowledgedAt: new Date(), status: 'acknowledged' })
          .where(eq(acquaintances.id, mine.id));
      }
      // When no one is left pending, the acknowledge step is complete.
      const [pending] = await tx
        .select({ id: acquaintances.id })
        .from(acquaintances)
        .where(and(eq(acquaintances.routeStepId, stepId), isNull(acquaintances.acknowledgedAt)))
        .limit(1);
      if (!pending) {
        await this.routes.applyStepCompletion(
          tx,
          route,
          stepId,
          'acknowledged',
          null,
          actor.id,
          new Date(),
        );
      }
      return route.documentId;
    });
    await this.audit.logAndWait({
      action: 'docflow.document.acknowledged',
      actorId: actor.id,
      entityType: 'document',
      entityId: documentId,
      meta: { stepId },
    });
    // Completing this step may have activated the next acknowledge group.
    await this.routes.expandAndNotifyAcknowledge(documentId);
    return this.sheetForDocument(documentId, actor);
  }

  async sheetForDocument(documentId: string, actor: AuthUser): Promise<AcknowledgementSheetDto> {
    const [doc] = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
      .limit(1);
    if (!doc || !(await this.canViewDocument(documentId, doc, actor))) {
      throw AppException.notFound('docflow.document.not_found', 'Document not found');
    }
    const rows = await this.db
      .select({
        id: acquaintances.id,
        userId: acquaintances.userId,
        userName: users.shortName,
        position: positions.name,
        acknowledgedAt: acquaintances.acknowledgedAt,
      })
      .from(acquaintances)
      .leftJoin(users, eq(users.id, acquaintances.userId))
      .leftJoin(
        userPositions,
        and(eq(userPositions.userId, acquaintances.userId), eq(userPositions.isPrimary, true)),
      )
      .leftJoin(positions, eq(positions.id, userPositions.positionId))
      .where(eq(acquaintances.documentId, documentId))
      .orderBy(asc(acquaintances.createdAt));

    const dto: AcquaintanceDto[] = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.userName ?? null,
      position: r.position ?? null,
      acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
    }));
    const acknowledged = dto.filter((r) => r.acknowledgedAt).length;

    // The step the caller can act on: an active acknowledge step where they have a
    // pending line.
    const [actionable] = await this.db
      .select({ stepId: acquaintances.routeStepId })
      .from(acquaintances)
      .innerJoin(routeSteps, eq(routeSteps.id, acquaintances.routeStepId))
      .where(
        and(
          eq(acquaintances.documentId, documentId),
          eq(acquaintances.userId, actor.id),
          isNull(acquaintances.acknowledgedAt),
          eq(routeSteps.status, 'active'),
        ),
      )
      .limit(1);

    return {
      rows: dto,
      total: dto.length,
      acknowledged,
      canAcknowledge: !!actionable?.stepId,
      stepId: actionable?.stepId ?? null,
    };
  }

  /** Documents with a pending acknowledgement line for the caller on an active step, and
   *  the step to act on — the row action of the «На ознакомление» queue. */
  async toAcknowledgeSteps(userId: string): Promise<{ documentId: string; stepId: string }[]> {
    const rows = await this.db
      .select({ documentId: acquaintances.documentId, stepId: acquaintances.routeStepId })
      .from(acquaintances)
      .innerJoin(routeSteps, eq(routeSteps.id, acquaintances.routeStepId))
      .where(
        and(
          eq(acquaintances.userId, userId),
          eq(acquaintances.status, 'pending'),
          eq(routeSteps.status, 'active'),
        ),
      );
    const byDoc = new Map<string, string>();
    for (const r of rows)
      if (r.stepId && !byDoc.has(r.documentId)) byDoc.set(r.documentId, r.stepId);
    return [...byDoc].map(([documentId, stepId]) => ({ documentId, stepId }));
  }

  /**
   * Every document the caller still owes a reading on — the «На ознакомление» queue and its
   * badge.
   *
   * Deliberately NOT built from `toAcknowledgeSteps`: that one joins `route_steps` to find
   * the step a row action posts to, and a line generated by a batch (a pre-execution gate or
   * a distribution) has no step. Building the queue from the join meant the queue that exists
   * precisely so people find what they must read could never show a distributed order at all
   * (plan этап 7 review).
   */
  async toAcknowledgeDocumentIds(userId: string): Promise<string[]> {
    const stepRows = await this.toAcknowledgeSteps(userId);
    const batchRows = await this.db
      .select({ documentId: acquaintances.documentId })
      .from(acquaintances)
      .innerJoin(acquaintanceBatches, eq(acquaintanceBatches.id, acquaintances.batchId))
      .where(
        and(
          eq(acquaintances.userId, userId),
          eq(acquaintances.status, 'pending'),
          // A released batch is closed: whoever did not answer is `expired`, and the rest
          // have read it. Nothing is owed on it any more.
          isNull(acquaintanceBatches.releasedAt),
        ),
      );
    return [
      ...new Set([...stepRows.map((r) => r.documentId), ...batchRows.map((r) => r.documentId)]),
    ];
  }

  /**
   * The same queue as one number. Counted in SQL as the union of the two sources — a document
   * reachable both through an active step and through an open batch is one document owed, not
   * two, and the outer `count(distinct …)` is what says so.
   */
  async toAcknowledgeCount(userId: string, visible: SQL): Promise<number> {
    // The outer join onto `documents` carries the caller's visibility. An acknowledge step
    // expands over a whole subdivision without consulting any допуск-список, so without it a
    // ДСП order would be COUNTED for people the list then refuses to show it to — a badge
    // that says «на ознакомлении: 1» over an empty list is a disclosure (AC-SED-06).
    const rows = await this.db.execute<{ n: number }>(sql`
      select count(distinct owed.document_id)::int as n from (
        select ${acquaintances.documentId} as document_id
          from ${acquaintances}
          join ${routeSteps} on ${routeSteps.id} = ${acquaintances.routeStepId}
          where ${acquaintances.userId} = ${userId}::uuid
            and ${acquaintances.status} = 'pending'
            and ${routeSteps.status} = 'active'
        union all
        select ${acquaintances.documentId} as document_id
          from ${acquaintances}
          join ${acquaintanceBatches} on ${acquaintanceBatches.id} = ${acquaintances.batchId}
          where ${acquaintances.userId} = ${userId}::uuid
            and ${acquaintances.status} = 'pending'
            and ${acquaintanceBatches.releasedAt} is null
      ) owed
      join ${documents} on ${documents.id} = owed.document_id
      where ${documents.deletedAt} is null and ${visible}`);
    return rows.rows[0]?.n ?? 0;
  }

  /** Whether the caller is on the document's acknowledgement sheet (for visibility). */
  async isAcquaintance(documentId: string, userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: acquaintances.id })
      .from(acquaintances)
      .where(and(eq(acquaintances.documentId, documentId), eq(acquaintances.userId, userId)))
      .limit(1);
    return !!row;
  }

  private async canViewDocument(
    documentId: string,
    doc: typeof documents.$inferSelect,
    actor: AuthUser,
  ): Promise<boolean> {
    if (canViewDocumentBase(doc, actor)) return true;
    if (await this.isAcquaintance(documentId, actor.id)) return true;
    const assignments = await this.routes.actorAssignments(actor.id);
    return this.routes.isRouteParticipant(documentId, assignments);
  }
}
