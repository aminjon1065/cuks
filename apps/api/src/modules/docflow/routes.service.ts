import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  acquaintances,
  documents,
  orgUnits,
  positions,
  routeSteps,
  routeTemplates,
  routes,
  userPositions,
  users,
  type Database,
} from '@cuks/db';
import type {
  CreateRouteTemplateInput,
  RouteDto,
  RouteStepDto,
  RouteStepInput,
  RouteTemplateDto,
  StartRouteInput,
  UpdateRouteTemplateInput,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { NotificationsService } from '../notifications/notifications.service';
import { canViewDocumentBase } from './document-visibility';
import { planApproval, type RouteStepState } from './route-engine';

/** The identities a user matches for step assignment: self, held positions, and the
 *  org units they head (docs/modules/11 §3). */
interface ActorAssignments {
  userIds: string[];
  positionIds: string[];
  orgUnitIds: string[];
}

/** Document routes: start, approve/reject, the approval queue and templates
 *  (docs/modules/11 §3/§4, task 3.3). */
@Injectable()
export class RoutesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // --- Assignment resolution -------------------------------------------------

  async actorAssignments(userId: string): Promise<ActorAssignments> {
    const rows = await this.db
      .select({
        positionId: userPositions.positionId,
        orgUnitId: positions.orgUnitId,
        isHead: positions.isHead,
      })
      .from(userPositions)
      .innerJoin(
        positions,
        and(eq(positions.id, userPositions.positionId), isNull(positions.deletedAt)),
      )
      .where(eq(userPositions.userId, userId));
    return {
      userIds: [userId],
      positionIds: [...new Set(rows.map((r) => r.positionId))],
      orgUnitIds: [...new Set(rows.filter((r) => r.isHead).map((r) => r.orgUnitId))],
    };
  }

  private matchesAssignment(
    step: { assigneeType: string; assigneeId: string },
    a: ActorAssignments,
  ): boolean {
    if (step.assigneeType === 'user') return a.userIds.includes(step.assigneeId);
    if (step.assigneeType === 'position') return a.positionIds.includes(step.assigneeId);
    if (step.assigneeType === 'org_unit') return a.orgUnitIds.includes(step.assigneeId);
    return false;
  }

  private canAct(
    step: { status: string; assigneeType: string; assigneeId: string },
    a: ActorAssignments,
    isSuperadmin: boolean,
  ): boolean {
    if (step.status !== 'active') return false;
    return isSuperadmin || this.matchesAssignment(step, a);
  }

  /** A SQL predicate over route_steps matching the caller's assignments (for the queue). */
  private assignmentPredicate(a: ActorAssignments): SQL | undefined {
    const clauses: SQL[] = [];
    if (a.userIds.length)
      clauses.push(
        and(eq(routeSteps.assigneeType, 'user'), inArray(routeSteps.assigneeId, a.userIds))!,
      );
    if (a.positionIds.length)
      clauses.push(
        and(
          eq(routeSteps.assigneeType, 'position'),
          inArray(routeSteps.assigneeId, a.positionIds),
        )!,
      );
    if (a.orgUnitIds.length)
      clauses.push(
        and(eq(routeSteps.assigneeType, 'org_unit'), inArray(routeSteps.assigneeId, a.orgUnitIds))!,
      );
    return clauses.length ? or(...clauses) : undefined;
  }

  /** The caller's active steps of a given kind, as {documentId, stepId} — one step per
   *  document (a document has at most one active step of a kind for a given assignee that
   *  matters for the row action). Backs both the queue id list and the row action. */
  private async queueSteps(
    userId: string,
    kind: 'approve' | 'sign',
  ): Promise<{ documentId: string; stepId: string }[]> {
    const assignments = await this.actorAssignments(userId);
    const match = this.assignmentPredicate(assignments);
    if (!match) return [];
    const rows = await this.db
      .select({ documentId: routes.documentId, stepId: routeSteps.id })
      .from(routeSteps)
      .innerJoin(routes, eq(routes.id, routeSteps.routeId))
      .where(
        and(
          eq(routes.status, 'active'),
          eq(routeSteps.status, 'active'),
          eq(routeSteps.kind, kind),
          match,
        ),
      );
    // Keep the first step per document (an active step of this kind is actionable).
    const byDoc = new Map<string, string>();
    for (const r of rows) if (!byDoc.has(r.documentId)) byDoc.set(r.documentId, r.stepId);
    return [...byDoc].map(([documentId, stepId]) => ({ documentId, stepId }));
  }

  /** The caller's «На согласование» documents with the active approve step to act on. */
  approvalQueueSteps(userId: string): Promise<{ documentId: string; stepId: string }[]> {
    return this.queueSteps(userId, 'approve');
  }

  /** The caller's «На подпись» documents with the active sign step. */
  signQueueSteps(userId: string): Promise<{ documentId: string; stepId: string }[]> {
    return this.queueSteps(userId, 'sign');
  }

  /** Document ids the caller has an active `approve` step on — the «На согласование» queue. */
  async approvalQueueDocumentIds(userId: string): Promise<string[]> {
    return (await this.approvalQueueSteps(userId)).map((r) => r.documentId);
  }

  /** Document ids the caller has an active `sign` step on — the «На подпись» queue. */
  async signQueueDocumentIds(userId: string): Promise<string[]> {
    return (await this.signQueueSteps(userId)).map((r) => r.documentId);
  }

  /**
   * Within a transaction: find and lock the document's active route, returning the
   * active `sign` step the actor may act on (or null). Used by the sign action, which
   * records the signature and advances the step in the same transaction.
   */
  async lockActiveSignStep(
    tx: Database,
    documentId: string,
    actor: AuthUser,
  ): Promise<{ route: typeof routes.$inferSelect; step: typeof routeSteps.$inferSelect } | null> {
    const assignments = await this.actorAssignments(actor.id);
    const [route] = await tx
      .select()
      .from(routes)
      .where(and(eq(routes.documentId, documentId), eq(routes.status, 'active')))
      .limit(1)
      .for('update');
    if (!route) return null;
    const steps = await tx
      .select()
      .from(routeSteps)
      .where(
        and(
          eq(routeSteps.routeId, route.id),
          eq(routeSteps.kind, 'sign'),
          eq(routeSteps.status, 'active'),
        ),
      );
    const step = steps.find((s) => this.canAct(s, assignments, actor.isSuperadmin));
    return step ? { route, step } : null;
  }

  /**
   * Mark a step done with the given decision and advance the route: activate the next
   * group, or — if this was the last group — complete the route and move the document to
   * `pending_registration`. Shared by the approve action and the sign action. The step
   * is treated as done for the activation plan (docs/modules/11 §4).
   */
  async applyStepCompletion(
    tx: Database,
    route: { id: string; documentId: string },
    stepId: string,
    decision: 'approved' | 'signed' | 'acknowledged',
    comment: string | null,
    actorId: string,
    now: Date,
  ): Promise<void> {
    await tx
      .update(routeSteps)
      .set({ status: 'done', decision, comment, actedBy: actorId, actedAt: now })
      .where(eq(routeSteps.id, stepId));
    const all = await tx
      .select({ id: routeSteps.id, stepOrder: routeSteps.stepOrder, status: routeSteps.status })
      .from(routeSteps)
      .where(eq(routeSteps.routeId, route.id));
    const plan = planApproval(all as RouteStepState[], stepId);
    if (plan.activateStepIds.length) {
      await tx
        .update(routeSteps)
        .set({ status: 'active' })
        .where(inArray(routeSteps.id, plan.activateStepIds));
    }
    if (plan.routeComplete) {
      await tx
        .update(routes)
        .set({ status: 'completed', completedAt: now })
        .where(eq(routes.id, route.id));
      await tx
        .update(documents)
        .set({ status: 'pending_registration' })
        .where(eq(documents.id, route.documentId));
    }
  }

  // --- Acknowledge expansion (task 3.6) --------------------------------------

  /** The users behind a step assignee (docs/modules/11 §3): the user itself, the holders
   *  of a position, or every member of a subdivision (an acknowledge step «разворачивается
   *  в список сотрудников»). */
  private async resolveAssigneeUsers(
    tx: Database,
    assigneeType: string,
    assigneeId: string,
  ): Promise<string[]> {
    if (assigneeType === 'user') return [assigneeId];
    if (assigneeType === 'position') {
      const rows = await tx
        .select({ userId: userPositions.userId })
        .from(userPositions)
        .where(eq(userPositions.positionId, assigneeId));
      return [...new Set(rows.map((r) => r.userId))];
    }
    // org_unit — every member with a (non-deleted) position in the subdivision.
    const rows = await tx
      .select({ userId: userPositions.userId })
      .from(userPositions)
      .innerJoin(
        positions,
        and(eq(positions.id, userPositions.positionId), isNull(positions.deletedAt)),
      )
      .where(eq(positions.orgUnitId, assigneeId));
    return [...new Set(rows.map((r) => r.userId))];
  }

  /**
   * Ensure every ACTIVE acknowledge step on the document's active route has its
   * acquaintance rows (expanding a subdivision to its members), then notify newly-added
   * people. Idempotent — safe to call after any route mutation that may have activated an
   * acknowledge step (docs/modules/11 §6, task 3.6).
   */
  async expandAndNotifyAcknowledge(documentId: string): Promise<void> {
    const added = await this.db.transaction(async (tx) => {
      const [route] = await tx
        .select({ id: routes.id })
        .from(routes)
        .where(and(eq(routes.documentId, documentId), eq(routes.status, 'active')))
        .limit(1);
      if (!route) return [];
      const steps = await tx
        .select()
        .from(routeSteps)
        .where(
          and(
            eq(routeSteps.routeId, route.id),
            eq(routeSteps.kind, 'acknowledge'),
            eq(routeSteps.status, 'active'),
          ),
        );
      const fresh: string[] = [];
      for (const step of steps) {
        const userIds = await this.resolveAssigneeUsers(tx, step.assigneeType, step.assigneeId);
        if (userIds.length === 0) continue;
        const existing = await tx
          .select({ userId: acquaintances.userId })
          .from(acquaintances)
          .where(eq(acquaintances.routeStepId, step.id));
        const have = new Set(existing.map((e) => e.userId));
        const toAdd = userIds.filter((u) => !have.has(u));
        if (toAdd.length === 0) continue;
        await tx
          .insert(acquaintances)
          .values(toAdd.map((userId) => ({ documentId, routeStepId: step.id, userId })))
          .onConflictDoNothing();
        fresh.push(...toAdd);
      }
      return fresh;
    });
    if (added.length > 0) {
      void this.notifications.notifyMany({
        userIds: [...new Set(added)],
        type: 'docflow.document.acknowledge_requested',
        title: 'Ознакомление с документом',
        body: 'Вам направлен документ на ознакомление',
        entityType: 'document',
        entityId: documentId,
        priority: 'normal',
        emailMode: 'offline',
      });
    }
  }

  /** Whether the caller is (or was) an assignee on any of the document's route steps. */
  async isRouteParticipant(documentId: string, assignments: ActorAssignments): Promise<boolean> {
    const match = this.assignmentPredicate(assignments);
    if (!match) return false;
    const [row] = await this.db
      .select({ id: routeSteps.id })
      .from(routeSteps)
      .innerJoin(routes, eq(routes.id, routeSteps.routeId))
      .where(and(eq(routes.documentId, documentId), match))
      .limit(1);
    return !!row;
  }

  // --- Route lifecycle -------------------------------------------------------

  async startRoute(
    documentId: string,
    input: StartRouteInput,
    actor: AuthUser,
  ): Promise<RouteDto[]> {
    const stepDefs = await this.resolveStepDefs(input);
    await this.db.transaction(async (tx) => {
      const [doc] = await tx
        .select()
        .from(documents)
        .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
        .limit(1)
        .for('update');
      if (!doc || !canViewDocumentBase(doc, actor)) {
        throw AppException.notFound('docflow.document.not_found', 'Document not found');
      }
      if (doc.authorId !== actor.id && !actor.isSuperadmin) {
        throw AppException.forbidden(
          'docflow.route.not_author',
          'Only the author may route this document',
        );
      }
      if (doc.status !== 'draft') {
        throw AppException.conflict(
          'docflow.route.not_draft',
          'Only a draft document can be sent to a route',
        );
      }
      const [prior] = await tx
        .select({ maxCycle: sql<number>`coalesce(max(${routes.cycle}), 0)::int` })
        .from(routes)
        .where(eq(routes.documentId, documentId));
      const [route] = await tx
        .insert(routes)
        .values({
          documentId,
          cycle: (prior?.maxCycle ?? 0) + 1,
          status: 'active',
          createdBy: actor.id,
        })
        .returning({ id: routes.id });
      if (!route) throw new Error('Route insert did not return an id');

      const minOrder = Math.min(...stepDefs.map((s) => s.order));
      const perOrder = new Map<number, number>();
      for (const s of stepDefs) perOrder.set(s.order, (perOrder.get(s.order) ?? 0) + 1);
      await tx.insert(routeSteps).values(
        stepDefs.map((s) => ({
          routeId: route.id,
          stepOrder: s.order,
          kind: s.kind,
          mode: (perOrder.get(s.order) ?? 1) > 1 ? ('parallel' as const) : ('sequential' as const),
          assigneeType: s.assigneeType,
          assigneeId: s.assigneeId,
          dueHours: s.dueHours ?? null,
          status: s.order === minOrder ? ('active' as const) : ('pending' as const),
        })),
      );
      await tx.update(documents).set({ status: 'on_route' }).where(eq(documents.id, documentId));
    });
    await this.audit.logAndWait({
      action: 'docflow.document.route_started',
      actorId: actor.id,
      entityType: 'document',
      entityId: documentId,
      meta: { steps: stepDefs.length },
    });
    // If the first group is an acknowledge step, expand the sheet and notify readers.
    await this.expandAndNotifyAcknowledge(documentId);
    return this.routesForDocument(documentId, actor);
  }

  async act(
    stepId: string,
    action: 'approve' | 'reject',
    comment: string | null,
    actor: AuthUser,
  ): Promise<RouteDto[]> {
    const assignments = await this.actorAssignments(actor.id);
    const documentId = await this.db.transaction(async (tx) => {
      const [locate] = await tx
        .select({ routeId: routeSteps.routeId })
        .from(routeSteps)
        .where(eq(routeSteps.id, stepId))
        .limit(1);
      if (!locate)
        throw AppException.notFound('docflow.route_step.not_found', 'Route step not found');
      const [route] = await tx
        .select()
        .from(routes)
        .where(eq(routes.id, locate.routeId))
        .limit(1)
        .for('update');
      if (!route || route.status !== 'active') {
        throw AppException.conflict('docflow.route.not_active', 'The route is not active');
      }
      const [step] = await tx.select().from(routeSteps).where(eq(routeSteps.id, stepId)).limit(1);
      if (!step || !this.canAct(step, assignments, actor.isSuperadmin)) {
        throw AppException.forbidden(
          'docflow.route_step.forbidden',
          'You may not act on this step',
        );
      }
      // Steps with a dedicated completion path must not be completed by a plain approval,
      // which would bypass their gate: a `sign` step needs a cryptographic signature
      // (SignaturesService.sign, 2FA/password/certificate — docs/09-security.md §4), and an
      // `acknowledge` step needs every assigned member to read it (AcknowledgementsService,
      // task 3.6). Declining still goes through reject (also the recovery path).
      if (action === 'approve' && step.kind === 'sign') {
        throw AppException.conflict(
          'docflow.route_step.sign_required',
          'A signing step must be completed by signing',
        );
      }
      if (action === 'approve' && step.kind === 'acknowledge') {
        throw AppException.conflict(
          'docflow.route_step.acknowledge_required',
          'An acknowledgement step is completed once every member reads it',
        );
      }
      const now = new Date();
      if (action === 'reject') {
        await tx
          .update(routeSteps)
          .set({
            status: 'rejected',
            decision: 'rejected',
            comment,
            actedBy: actor.id,
            actedAt: now,
          })
          .where(eq(routeSteps.id, stepId));
        await tx
          .update(routes)
          .set({ status: 'cancelled', completedAt: now })
          .where(eq(routes.id, route.id));
        // Rejection returns the document to the author for rework (docs/modules/11 §4).
        await tx
          .update(documents)
          .set({ status: 'draft' })
          .where(eq(documents.id, route.documentId));
        return route.documentId;
      }
      await this.applyStepCompletion(tx, route, stepId, 'approved', comment, actor.id, now);
      return route.documentId;
    });
    await this.audit.logAndWait({
      action:
        action === 'reject'
          ? 'docflow.document.route_rejected'
          : 'docflow.document.route_step_done',
      actorId: actor.id,
      entityType: 'document',
      entityId: documentId,
      meta: { stepId },
    });
    // Approving may have activated an acknowledge step — expand its sheet and notify.
    if (action === 'approve') await this.expandAndNotifyAcknowledge(documentId);
    return this.routesForDocument(documentId, actor);
  }

  async routesForDocument(documentId: string, actor: AuthUser): Promise<RouteDto[]> {
    const [doc] = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
      .limit(1);
    const assignments = await this.actorAssignments(actor.id);
    const visible =
      !!doc &&
      (canViewDocumentBase(doc, actor) || (await this.isRouteParticipant(documentId, assignments)));
    if (!visible) throw AppException.notFound('docflow.document.not_found', 'Document not found');

    const routeRows = await this.db
      .select()
      .from(routes)
      .where(eq(routes.documentId, documentId))
      .orderBy(desc(routes.cycle));
    if (routeRows.length === 0) return [];
    const stepRows = await this.db
      .select()
      .from(routeSteps)
      .where(
        inArray(
          routeSteps.routeId,
          routeRows.map((r) => r.id),
        ),
      )
      .orderBy(asc(routeSteps.stepOrder), asc(routeSteps.createdAt));

    const names = await this.resolveNames(stepRows, routeRows);
    return routeRows.map((route) => ({
      id: route.id,
      cycle: route.cycle,
      status: route.status,
      createdByName: route.createdBy ? (names.users.get(route.createdBy) ?? null) : null,
      createdAt: route.createdAt.toISOString(),
      completedAt: route.completedAt?.toISOString() ?? null,
      steps: stepRows
        .filter((s) => s.routeId === route.id)
        .map((s): RouteStepDto => ({
          id: s.id,
          stepOrder: s.stepOrder,
          kind: s.kind,
          assigneeType: s.assigneeType,
          assigneeId: s.assigneeId,
          assigneeName: names.assignee(s.assigneeType, s.assigneeId),
          status: s.status,
          decision: s.decision,
          comment: s.comment,
          actedByName: s.actedBy ? (names.users.get(s.actedBy) ?? null) : null,
          actedAt: s.actedAt?.toISOString() ?? null,
          dueHours: s.dueHours,
          canAct: this.canAct(s, assignments, actor.isSuperadmin),
        })),
    }));
  }

  // --- Templates -------------------------------------------------------------

  async listTemplates(): Promise<RouteTemplateDto[]> {
    const rows = await this.db
      .select({
        id: routeTemplates.id,
        name: routeTemplates.name,
        orgUnitId: routeTemplates.orgUnitId,
        orgUnitName: orgUnits.name,
        steps: routeTemplates.steps,
        isActive: routeTemplates.isActive,
      })
      .from(routeTemplates)
      .leftJoin(orgUnits, eq(orgUnits.id, routeTemplates.orgUnitId))
      .where(isNull(routeTemplates.deletedAt))
      .orderBy(asc(routeTemplates.name));
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      orgUnitId: r.orgUnitId,
      orgUnitName: r.orgUnitName ?? null,
      steps: r.steps as RouteStepInput[],
      isActive: r.isActive,
    }));
  }

  async createTemplate(
    input: CreateRouteTemplateInput,
    actor: AuthUser,
  ): Promise<RouteTemplateDto> {
    const [created] = await this.db
      .insert(routeTemplates)
      .values({
        name: input.name,
        orgUnitId: input.orgUnitId ?? null,
        steps: input.steps,
        isActive: input.isActive ?? true,
        createdBy: actor.id,
      })
      .returning({ id: routeTemplates.id });
    if (!created)
      throw AppException.badRequest(
        'docflow.route_template.create_failed',
        'Could not create template',
      );
    this.audit.log({
      action: 'docflow.route_template.created',
      actorId: actor.id,
      entityType: 'route_template',
      entityId: created.id,
    });
    return this.getTemplate(created.id);
  }

  async updateTemplate(
    id: string,
    input: UpdateRouteTemplateInput,
    actor: AuthUser,
  ): Promise<RouteTemplateDto> {
    await this.requireTemplate(id);
    await this.db
      .update(routeTemplates)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.orgUnitId !== undefined ? { orgUnitId: input.orgUnitId ?? null } : {}),
        ...(input.steps !== undefined ? { steps: input.steps } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      })
      .where(eq(routeTemplates.id, id));
    this.audit.log({
      action: 'docflow.route_template.updated',
      actorId: actor.id,
      entityType: 'route_template',
      entityId: id,
    });
    return this.getTemplate(id);
  }

  async removeTemplate(id: string, actor: AuthUser): Promise<void> {
    await this.requireTemplate(id);
    await this.db
      .update(routeTemplates)
      .set({ deletedAt: new Date() })
      .where(eq(routeTemplates.id, id));
    this.audit.log({
      action: 'docflow.route_template.deleted',
      actorId: actor.id,
      entityType: 'route_template',
      entityId: id,
    });
  }

  // --- Internals -------------------------------------------------------------

  private async resolveStepDefs(input: StartRouteInput): Promise<RouteStepInput[]> {
    if (input.steps) return input.steps;
    const [tpl] = await this.db
      .select({ steps: routeTemplates.steps })
      .from(routeTemplates)
      .where(and(eq(routeTemplates.id, input.templateId!), isNull(routeTemplates.deletedAt)))
      .limit(1);
    if (!tpl)
      throw AppException.notFound('docflow.route_template.not_found', 'Route template not found');
    const steps = tpl.steps as RouteStepInput[];
    if (!Array.isArray(steps) || steps.length === 0) {
      throw AppException.unprocessable(
        'docflow.route_template.empty',
        'The route template has no steps',
      );
    }
    return steps;
  }

  private async requireTemplate(id: string): Promise<void> {
    const [row] = await this.db
      .select({ id: routeTemplates.id })
      .from(routeTemplates)
      .where(and(eq(routeTemplates.id, id), isNull(routeTemplates.deletedAt)))
      .limit(1);
    if (!row)
      throw AppException.notFound('docflow.route_template.not_found', 'Route template not found');
  }

  private async getTemplate(id: string): Promise<RouteTemplateDto> {
    const row = (await this.listTemplates()).find((tpl) => tpl.id === id);
    if (!row)
      throw AppException.notFound('docflow.route_template.not_found', 'Route template not found');
    return row;
  }

  /** Batch-resolve display names for step assignees + actors across a set of steps. */
  private async resolveNames(
    steps: (typeof routeSteps.$inferSelect)[],
    routeRows: (typeof routes.$inferSelect)[],
  ) {
    const userIds = new Set<string>();
    const positionIds = new Set<string>();
    const orgUnitIds = new Set<string>();
    for (const s of steps) {
      if (s.assigneeType === 'user') userIds.add(s.assigneeId);
      if (s.assigneeType === 'position') positionIds.add(s.assigneeId);
      if (s.assigneeType === 'org_unit') orgUnitIds.add(s.assigneeId);
      if (s.actedBy) userIds.add(s.actedBy);
    }
    for (const r of routeRows) if (r.createdBy) userIds.add(r.createdBy);

    const [userRows, positionRows, orgUnitRows] = await Promise.all([
      userIds.size
        ? this.db
            .select({ id: users.id, name: users.shortName })
            .from(users)
            .where(inArray(users.id, [...userIds]))
        : Promise.resolve([]),
      positionIds.size
        ? this.db
            .select({ id: positions.id, name: positions.name })
            .from(positions)
            .where(inArray(positions.id, [...positionIds]))
        : Promise.resolve([]),
      orgUnitIds.size
        ? this.db
            .select({ id: orgUnits.id, name: orgUnits.name })
            .from(orgUnits)
            .where(inArray(orgUnits.id, [...orgUnitIds]))
        : Promise.resolve([]),
    ]);
    const usersMap = new Map(userRows.map((r) => [r.id, r.name]));
    const positionsMap = new Map(positionRows.map((r) => [r.id, r.name]));
    const orgUnitsMap = new Map(orgUnitRows.map((r) => [r.id, r.name]));
    return {
      users: usersMap,
      assignee: (type: string, id: string): string | null =>
        type === 'user'
          ? (usersMap.get(id) ?? null)
          : type === 'position'
            ? (positionsMap.get(id) ?? null)
            : (orgUnitsMap.get(id) ?? null),
    };
  }
}
