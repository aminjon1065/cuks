import { Inject, Injectable } from '@nestjs/common';
import { and, arrayContains, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import { documents, resolutionExtensions, resolutions, users, type Database } from '@cuks/db';
import type {
  CreateResolutionInput,
  ExtendResolutionInput,
  RemoveResolutionControlInput,
  ReportResolutionInput,
  ResolutionDto,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';
import { canViewDocumentBase } from './document-visibility';

/** Superadmin or a control officer may extend/cancel any resolution (docs/modules/11 §5). */
function isControlUser(user: AuthUser): boolean {
  return user.isSuperadmin || user.permissions.includes('docflow.control');
}

/** Resolutions: instructions on a document, their sub-resolutions, execution and
 *  deadline extensions (docs/modules/11 §3/§5, task 3.4). */
@Injectable()
export class ResolutionsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  // --- Participation / queue -------------------------------------------------

  /** Whether the caller authored / executes / co-executes any resolution on the document. */
  async isResolutionParticipant(documentId: string, userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: resolutions.id })
      .from(resolutions)
      .where(and(eq(resolutions.documentId, documentId), this.mine(userId)))
      .limit(1);
    return !!row;
  }

  /** Document ids the caller has an active resolution to execute — «Мои поручения». */
  async myTasksDocumentIds(userId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ documentId: resolutions.documentId })
      .from(resolutions)
      .where(
        and(
          eq(resolutions.status, 'active'),
          or(
            eq(resolutions.executorId, userId),
            // `@>` (arrayContains) so the co_executors GIN index is usable; `= ANY()` is not.
            arrayContains(resolutions.coExecutors, [userId]),
          ),
        ),
      );
    return rows.map((r) => r.documentId);
  }

  private mine(userId: string) {
    return or(
      eq(resolutions.authorId, userId),
      eq(resolutions.executorId, userId),
      arrayContains(resolutions.coExecutors, [userId]),
    );
  }

  // --- Commands --------------------------------------------------------------

  async create(
    documentId: string,
    input: CreateResolutionInput,
    actor: AuthUser,
  ): Promise<ResolutionDto[]> {
    await this.db.transaction(async (tx) => {
      const doc = await this.requireVisibleDoc(tx, documentId, actor);
      // A document may be resolved only while it is under execution: after registration
      // (`registered`) and until it is closed (`in_progress`). Not before registration
      // (draft/on_route/pending_registration) nor after (completed/archived/rejected/recalled).
      if (doc.status !== 'registered' && doc.status !== 'in_progress') {
        throw AppException.conflict(
          'docflow.resolution.doc_not_ready',
          'Resolve a document only after registration',
        );
      }
      await tx.insert(resolutions).values({
        documentId,
        authorId: actor.id,
        executorId: input.executorId,
        coExecutors: input.coExecutors ?? [],
        text: input.text,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        isControl: input.isControl ?? false,
      });
      // Issuing an instruction starts execution.
      if (doc.status === 'registered') {
        await tx
          .update(documents)
          .set({ status: 'in_progress' })
          .where(eq(documents.id, documentId));
      }
    });
    this.audit.log({
      action: 'docflow.document.resolution_added',
      actorId: actor.id,
      entityType: 'document',
      entityId: documentId,
      meta: { executorId: input.executorId, isControl: input.isControl ?? false },
    });
    return this.forDocument(documentId, actor);
  }

  /** A sub-resolution: the parent's executor/co-executor delegates onward. */
  async createSub(
    parentId: string,
    input: CreateResolutionInput,
    actor: AuthUser,
  ): Promise<ResolutionDto[]> {
    const documentId = await this.db.transaction(async (tx) => {
      const [parent] = await tx
        .select()
        .from(resolutions)
        .where(eq(resolutions.id, parentId))
        .limit(1);
      if (!parent)
        throw AppException.notFound('docflow.resolution.not_found', 'Resolution not found');
      await this.requireVisibleDoc(tx, parent.documentId, actor);
      if (!this.isExecutor(parent, actor) && !isControlUser(actor)) {
        throw AppException.forbidden(
          'docflow.resolution.not_executor',
          'Only the executor may sub-delegate',
        );
      }
      if (parent.status !== 'active') {
        throw AppException.conflict(
          'docflow.resolution.not_active',
          'The resolution is not active',
        );
      }
      await tx.insert(resolutions).values({
        documentId: parent.documentId,
        parentId,
        authorId: actor.id,
        executorId: input.executorId,
        coExecutors: input.coExecutors ?? [],
        text: input.text,
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        isControl: input.isControl ?? false,
      });
      return parent.documentId;
    });
    this.audit.log({
      action: 'docflow.document.resolution_added',
      actorId: actor.id,
      entityType: 'document',
      entityId: documentId,
      meta: { parentId },
    });
    return this.forDocument(documentId, actor);
  }

  async report(
    resolutionId: string,
    input: ReportResolutionInput,
    actor: AuthUser,
  ): Promise<ResolutionDto[]> {
    return this.mutate(resolutionId, actor, async (tx, res) => {
      if (!this.isExecutor(res, actor)) {
        throw AppException.forbidden(
          'docflow.resolution.not_executor',
          'Only the executor may report',
        );
      }
      if (res.status !== 'active') {
        throw AppException.conflict(
          'docflow.resolution.not_active',
          'The resolution is not active',
        );
      }
      await tx
        .update(resolutions)
        .set({ report: input.report })
        .where(eq(resolutions.id, resolutionId));
      return 'docflow.document.resolution_reported';
    });
  }

  async complete(resolutionId: string, actor: AuthUser): Promise<ResolutionDto[]> {
    return this.mutate(resolutionId, actor, async (tx, res) => {
      if (!this.isExecutor(res, actor) && res.authorId !== actor.id && !isControlUser(actor)) {
        throw AppException.forbidden(
          'docflow.resolution.forbidden',
          'You may not complete this resolution',
        );
      }
      if (res.status !== 'active') {
        throw AppException.conflict(
          'docflow.resolution.not_active',
          'The resolution is not active',
        );
      }
      await tx
        .update(resolutions)
        .set({ status: 'done', doneAt: new Date() })
        .where(eq(resolutions.id, resolutionId));
      return 'docflow.document.resolution_done';
    });
  }

  async extend(
    resolutionId: string,
    input: ExtendResolutionInput,
    actor: AuthUser,
  ): Promise<ResolutionDto[]> {
    return this.mutate(resolutionId, actor, async (tx, res) => {
      if (res.authorId !== actor.id && !isControlUser(actor)) {
        throw AppException.forbidden(
          'docflow.resolution.forbidden',
          'Only the author or a controller may extend',
        );
      }
      if (res.status !== 'active') {
        throw AppException.conflict(
          'docflow.resolution.not_active',
          'The resolution is not active',
        );
      }
      const newDue = new Date(input.newDue);
      await tx.insert(resolutionExtensions).values({
        resolutionId,
        oldDue: res.dueDate,
        newDue,
        reason: input.reason,
        extendedBy: actor.id,
      });
      await tx
        .update(resolutions)
        .set({ dueDate: newDue, isControl: true })
        .where(eq(resolutions.id, resolutionId));
      return 'docflow.document.resolution_extended';
    });
  }

  async cancel(resolutionId: string, actor: AuthUser): Promise<ResolutionDto[]> {
    return this.mutate(resolutionId, actor, async (tx, res) => {
      if (res.authorId !== actor.id && !isControlUser(actor)) {
        throw AppException.forbidden(
          'docflow.resolution.forbidden',
          'Only the author or a controller may cancel',
        );
      }
      if (res.status !== 'active') {
        throw AppException.conflict(
          'docflow.resolution.not_active',
          'The resolution is not active',
        );
      }
      await tx
        .update(resolutions)
        .set({ status: 'cancelled' })
        .where(eq(resolutions.id, resolutionId));
      return 'docflow.document.resolution_cancelled';
    });
  }

  /** Remove a resolution from control (docs/modules/11 §5): keep it active, clear the
   *  control flag; author or control officer only, with a reason (audited). */
  async removeFromControl(
    resolutionId: string,
    input: RemoveResolutionControlInput,
    actor: AuthUser,
  ): Promise<ResolutionDto[]> {
    return this.mutate(
      resolutionId,
      actor,
      async (tx, res) => {
        if (res.authorId !== actor.id && !isControlUser(actor)) {
          throw AppException.forbidden(
            'docflow.resolution.forbidden',
            'Only the author or a controller may remove from control',
          );
        }
        if (res.status !== 'active') {
          throw AppException.conflict(
            'docflow.resolution.not_active',
            'The resolution is not active',
          );
        }
        if (!res.isControl) {
          throw AppException.conflict(
            'docflow.resolution.not_controlled',
            'The resolution is not on control',
          );
        }
        await tx
          .update(resolutions)
          .set({ isControl: false })
          .where(eq(resolutions.id, resolutionId));
        return 'docflow.document.resolution_uncontrolled';
      },
      { reason: input.reason },
    );
  }

  // --- Read ------------------------------------------------------------------

  async forDocument(documentId: string, actor: AuthUser): Promise<ResolutionDto[]> {
    const [doc] = await this.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
      .limit(1);
    const visible =
      !!doc &&
      (canViewDocumentBase(doc, actor) ||
        (await this.isResolutionParticipant(documentId, actor.id)));
    if (!visible) throw AppException.notFound('docflow.document.not_found', 'Document not found');

    const rows = await this.db
      .select()
      .from(resolutions)
      .where(eq(resolutions.documentId, documentId))
      .orderBy(asc(resolutions.createdAt));
    if (rows.length === 0) return [];

    const extRows = await this.db
      .select()
      .from(resolutionExtensions)
      .where(
        inArray(
          resolutionExtensions.resolutionId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(resolutionExtensions.createdAt));
    const names = await this.resolveNames(rows, extRows);

    const dtoById = new Map<string, ResolutionDto>();
    for (const r of rows) {
      dtoById.set(r.id, {
        id: r.id,
        parentId: r.parentId,
        authorId: r.authorId,
        authorName: names.get(r.authorId) ?? null,
        executorId: r.executorId,
        executorName: names.get(r.executorId) ?? null,
        coExecutors: r.coExecutors,
        coExecutorNames: r.coExecutors.map((id) => names.get(id) ?? id),
        text: r.text,
        dueDate: r.dueDate?.toISOString() ?? null,
        isControl: r.isControl,
        status: r.status,
        report: r.report,
        doneAt: r.doneAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        extensions: extRows
          .filter((e) => e.resolutionId === r.id)
          .map((e) => ({
            id: e.id,
            oldDue: e.oldDue?.toISOString() ?? null,
            newDue: e.newDue.toISOString(),
            reason: e.reason,
            extendedByName: e.extendedBy ? (names.get(e.extendedBy) ?? null) : null,
            createdAt: e.createdAt.toISOString(),
          })),
        canReport: this.isExecutor(r, actor) && r.status === 'active',
        canManage: (r.authorId === actor.id || isControlUser(actor)) && r.status === 'active',
        children: [],
      });
    }
    // Nest sub-resolutions under their parents; return the roots.
    const roots: ResolutionDto[] = [];
    for (const dto of dtoById.values()) {
      const parent = dto.parentId ? dtoById.get(dto.parentId) : undefined;
      if (parent) parent.children.push(dto);
      else roots.push(dto);
    }
    return roots;
  }

  // --- Internals -------------------------------------------------------------

  private isExecutor(res: typeof resolutions.$inferSelect, actor: AuthUser): boolean {
    return res.executorId === actor.id || res.coExecutors.includes(actor.id);
  }

  private async mutate(
    resolutionId: string,
    actor: AuthUser,
    fn: (tx: Database, res: typeof resolutions.$inferSelect) => Promise<string>,
    extraMeta?: Record<string, unknown>,
  ): Promise<ResolutionDto[]> {
    const { documentId, action } = await this.db.transaction(async (tx) => {
      const [res] = await tx
        .select()
        .from(resolutions)
        .where(eq(resolutions.id, resolutionId))
        .limit(1)
        .for('update');
      if (!res) throw AppException.notFound('docflow.resolution.not_found', 'Resolution not found');
      await this.requireVisibleDoc(tx, res.documentId, actor);
      const action = await fn(tx, res);
      return { documentId: res.documentId, action };
    });
    await this.audit.logAndWait({
      action,
      actorId: actor.id,
      entityType: 'document',
      entityId: documentId,
      meta: { resolutionId, ...extraMeta },
    });
    return this.forDocument(documentId, actor);
  }

  private async requireVisibleDoc(
    tx: Database,
    documentId: string,
    actor: AuthUser,
  ): Promise<typeof documents.$inferSelect> {
    const [doc] = await tx
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), isNull(documents.deletedAt)))
      .limit(1);
    if (
      !doc ||
      (!canViewDocumentBase(doc, actor) &&
        !(await this.isResolutionParticipant(documentId, actor.id)))
    ) {
      throw AppException.notFound('docflow.document.not_found', 'Document not found');
    }
    return doc;
  }

  private async resolveNames(
    rows: (typeof resolutions.$inferSelect)[],
    extRows: (typeof resolutionExtensions.$inferSelect)[],
  ): Promise<Map<string, string>> {
    const ids = new Set<string>();
    for (const r of rows) {
      ids.add(r.authorId);
      ids.add(r.executorId);
      for (const c of r.coExecutors) ids.add(c);
    }
    for (const e of extRows) if (e.extendedBy) ids.add(e.extendedBy);
    if (ids.size === 0) return new Map();
    const userRows = await this.db
      .select({ id: users.id, name: users.shortName })
      .from(users)
      .where(inArray(users.id, [...ids]));
    return new Map(userRows.map((u) => [u.id, u.name]));
  }
}
