import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
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
        await tx
          .update(acquaintances)
          .set({ acknowledgedAt: new Date() })
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
   *  the step to act on — the «На ознакомление» queue + its row action. */
  async toAcknowledgeSteps(userId: string): Promise<{ documentId: string; stepId: string }[]> {
    const rows = await this.db
      .select({ documentId: acquaintances.documentId, stepId: acquaintances.routeStepId })
      .from(acquaintances)
      .innerJoin(routeSteps, eq(routeSteps.id, acquaintances.routeStepId))
      .where(
        and(
          eq(acquaintances.userId, userId),
          isNull(acquaintances.acknowledgedAt),
          eq(routeSteps.status, 'active'),
        ),
      );
    const byDoc = new Map<string, string>();
    for (const r of rows)
      if (r.stepId && !byDoc.has(r.documentId)) byDoc.set(r.documentId, r.stepId);
    return [...byDoc].map(([documentId, stepId]) => ({ documentId, stepId }));
  }

  async toAcknowledgeDocumentIds(userId: string): Promise<string[]> {
    return (await this.toAcknowledgeSteps(userId)).map((r) => r.documentId);
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
