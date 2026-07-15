import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { correspondents, type Database } from '@cuks/db';
import type {
  CorrespondentDto,
  CorrespondentsQuery,
  CreateCorrespondentInput,
  UpdateCorrespondentInput,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';

type Actor = Pick<AuthUser, 'id'>;
const SEARCH_LIMIT = 50;

/**
 * Correspondent directory (docs/07 §correspondents). Read + create-on-the-fly is
 * open to `docflow.use` (the registration wizard searches and adds inline); editing
 * and removal are the same permission for now (chancellery data). Soft-deleted.
 */
@Injectable()
export class CorrespondentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(query: CorrespondentsQuery): Promise<CorrespondentDto[]> {
    const where: SQL[] = [isNull(correspondents.deletedAt)];
    if (query.activeOnly) where.push(eq(correspondents.isActive, true));
    if (query.search) {
      const text = `%${query.search}%`;
      const match = or(ilike(correspondents.name, text), ilike(correspondents.shortName, text));
      if (match) where.push(match);
    }
    const rows = await this.db
      .select()
      .from(correspondents)
      .where(and(...where))
      .orderBy(asc(correspondents.name))
      .limit(SEARCH_LIMIT);
    return rows.map(toDto);
  }

  async create(input: CreateCorrespondentInput, actor: Actor): Promise<CorrespondentDto> {
    const [created] = await this.db
      .insert(correspondents)
      .values({
        name: input.name,
        shortName: input.shortName ?? null,
        categoryCode: input.categoryCode ?? null,
        address: input.address ?? null,
        phones: input.phones ?? null,
        email: input.email ?? null,
        isActive: input.isActive ?? true,
        createdBy: actor.id,
      })
      .returning();
    if (!created) {
      throw AppException.badRequest(
        'docflow.correspondent.create_failed',
        'Could not create correspondent',
      );
    }
    this.audit.log({
      action: 'docflow.correspondent.created',
      actorId: actor.id,
      entityType: 'correspondent',
      entityId: created.id,
    });
    return toDto(created);
  }

  async update(
    id: string,
    input: UpdateCorrespondentInput,
    actor: Actor,
  ): Promise<CorrespondentDto> {
    await this.require(id);
    const [updated] = await this.db
      .update(correspondents)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.shortName !== undefined ? { shortName: input.shortName ?? null } : {}),
        ...(input.categoryCode !== undefined ? { categoryCode: input.categoryCode ?? null } : {}),
        ...(input.address !== undefined ? { address: input.address ?? null } : {}),
        ...(input.phones !== undefined ? { phones: input.phones ?? null } : {}),
        ...(input.email !== undefined ? { email: input.email ?? null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      })
      .where(eq(correspondents.id, id))
      .returning();
    if (!updated) {
      throw AppException.notFound('docflow.correspondent.not_found', 'Correspondent not found');
    }
    this.audit.log({
      action: 'docflow.correspondent.updated',
      actorId: actor.id,
      entityType: 'correspondent',
      entityId: id,
    });
    return toDto(updated);
  }

  async remove(id: string, actor: Actor): Promise<void> {
    await this.require(id);
    await this.db
      .update(correspondents)
      .set({ deletedAt: new Date() })
      .where(eq(correspondents.id, id));
    this.audit.log({
      action: 'docflow.correspondent.deleted',
      actorId: actor.id,
      entityType: 'correspondent',
      entityId: id,
    });
  }

  private async require(id: string): Promise<void> {
    const [row] = await this.db
      .select({ id: correspondents.id })
      .from(correspondents)
      .where(and(eq(correspondents.id, id), isNull(correspondents.deletedAt)))
      .limit(1);
    if (!row) {
      throw AppException.notFound('docflow.correspondent.not_found', 'Correspondent not found');
    }
  }
}

function toDto(row: typeof correspondents.$inferSelect): CorrespondentDto {
  return {
    id: row.id,
    name: row.name,
    shortName: row.shortName,
    categoryCode: row.categoryCode,
    address: row.address,
    phones: row.phones,
    email: row.email,
    isActive: row.isActive,
  };
}
