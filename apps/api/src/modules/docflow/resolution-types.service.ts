import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, isNull } from 'drizzle-orm';
import { resolutionProposals, resolutionTypes, type Database } from '@cuks/db';
import type {
  CreateResolutionTypeInput,
  ResolutionTypeDto,
  UpdateResolutionTypeInput,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';

type Actor = Pick<AuthUser, 'id'>;

/**
 * The resolution-type dictionary (docs/modules/11 §12.11) — what a типовая резолюция
 * pre-fills and insists on. Chancellery-managed (`docflow.journals.manage`), readable by
 * anyone who may draft a proposal.
 *
 * The table has no soft delete: a proposal references its type with `on delete restrict`,
 * so a type that has ever been used stays, and «убрать из списка» means deactivating it.
 * A used type therefore refuses deletion with a code the UI can explain, instead of
 * surfacing a foreign-key error.
 */
@Injectable()
export class ResolutionTypesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** `activeOnly` is what the proposal form asks for; settings lists everything. */
  async list(activeOnly = false): Promise<ResolutionTypeDto[]> {
    const rows = await this.db
      .select()
      .from(resolutionTypes)
      .where(activeOnly ? eq(resolutionTypes.isActive, true) : undefined)
      .orderBy(asc(resolutionTypes.sortOrder), asc(resolutionTypes.nameRu));
    return rows.map((r) => this.toDto(r));
  }

  async create(input: CreateResolutionTypeInput, actor: Actor): Promise<ResolutionTypeDto> {
    const [existing] = await this.db
      .select({ id: resolutionTypes.id })
      .from(resolutionTypes)
      .where(eq(resolutionTypes.code, input.code));
    if (existing) {
      throw AppException.badRequest(
        'docflow.resolution_type.code_taken',
        'Resolution type code already exists',
      );
    }
    const [created] = await this.db
      .insert(resolutionTypes)
      .values({
        code: input.code,
        nameRu: input.nameRu,
        nameTj: input.nameTj,
        actionKind: input.actionKind,
        requiresDueAt: input.requiresDueAt,
        requiresExecutor: input.requiresExecutor,
        requiresOutgoingResponse: input.requiresOutgoingResponse,
        defaultControl: input.defaultControl,
        defaultDueHours: input.defaultDueHours ?? null,
        isActive: input.isActive,
        sortOrder: input.sortOrder,
      })
      .returning();
    if (!created) throw new Error('Resolution type insert did not return a row');
    await this.audit.logAndWait({
      action: 'docflow.resolution_type.created',
      actorId: actor.id,
      entityType: 'resolution_type',
      entityId: created.id,
      meta: { code: created.code },
    });
    return this.toDto(created);
  }

  async update(
    id: string,
    input: UpdateResolutionTypeInput,
    actor: Actor,
  ): Promise<ResolutionTypeDto> {
    const [updated] = await this.db
      .update(resolutionTypes)
      .set({
        ...(input.nameRu !== undefined ? { nameRu: input.nameRu } : {}),
        ...(input.nameTj !== undefined ? { nameTj: input.nameTj } : {}),
        ...(input.actionKind !== undefined ? { actionKind: input.actionKind } : {}),
        ...(input.requiresDueAt !== undefined ? { requiresDueAt: input.requiresDueAt } : {}),
        ...(input.requiresExecutor !== undefined
          ? { requiresExecutor: input.requiresExecutor }
          : {}),
        ...(input.requiresOutgoingResponse !== undefined
          ? { requiresOutgoingResponse: input.requiresOutgoingResponse }
          : {}),
        ...(input.defaultControl !== undefined ? { defaultControl: input.defaultControl } : {}),
        ...(input.defaultDueHours !== undefined
          ? { defaultDueHours: input.defaultDueHours ?? null }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(eq(resolutionTypes.id, id))
      .returning();
    if (!updated) {
      throw AppException.notFound('docflow.resolution_type.not_found', 'Resolution type not found');
    }
    await this.audit.logAndWait({
      action: 'docflow.resolution_type.updated',
      actorId: actor.id,
      entityType: 'resolution_type',
      entityId: id,
      meta: { code: updated.code },
    });
    return this.toDto(updated);
  }

  async remove(id: string, actor: Actor): Promise<void> {
    const [used] = await this.db
      .select({ n: count() })
      .from(resolutionProposals)
      .where(
        and(eq(resolutionProposals.resolutionTypeId, id), isNull(resolutionProposals.deletedAt)),
      );
    if ((used?.n ?? 0) > 0) {
      // Deleting it would either fail on the foreign key or erase what a live proposal
      // says it is — deactivating hides it from the picker and keeps the history readable.
      throw AppException.conflict(
        'docflow.resolution_type.in_use',
        'The type is used by existing proposals — deactivate it instead',
        { proposals: used?.n ?? 0 },
      );
    }
    const [deleted] = await this.db
      .delete(resolutionTypes)
      .where(eq(resolutionTypes.id, id))
      .returning({ code: resolutionTypes.code });
    if (!deleted) {
      throw AppException.notFound('docflow.resolution_type.not_found', 'Resolution type not found');
    }
    await this.audit.logAndWait({
      action: 'docflow.resolution_type.deleted',
      actorId: actor.id,
      entityType: 'resolution_type',
      entityId: id,
      meta: { code: deleted.code },
    });
  }

  private toDto(row: typeof resolutionTypes.$inferSelect): ResolutionTypeDto {
    return {
      id: row.id,
      code: row.code,
      nameRu: row.nameRu,
      nameTj: row.nameTj,
      actionKind: row.actionKind,
      requiresDueAt: row.requiresDueAt,
      requiresExecutor: row.requiresExecutor,
      requiresOutgoingResponse: row.requiresOutgoingResponse,
      defaultControl: row.defaultControl,
      defaultDueHours: row.defaultDueHours,
      isActive: row.isActive,
      sortOrder: row.sortOrder,
    };
  }
}
