import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { nomenclature, orgUnits, type Database } from '@cuks/db';
import type {
  CreateNomenclatureInput,
  NomenclatureDto,
  UpdateNomenclatureInput,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';

type Actor = Pick<AuthUser, 'id'>;

/** Case-index registry (docs/modules/11 §1). `docflow.journals.manage`. Soft-deleted. */
@Injectable()
export class NomenclatureService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<NomenclatureDto[]> {
    const rows = await this.db
      .select({
        id: nomenclature.id,
        index: nomenclature.index,
        title: nomenclature.title,
        orgUnitId: nomenclature.orgUnitId,
        orgUnitName: orgUnits.name,
        retentionNote: nomenclature.retentionNote,
        sort: nomenclature.sort,
        isActive: nomenclature.isActive,
      })
      .from(nomenclature)
      .leftJoin(orgUnits, eq(orgUnits.id, nomenclature.orgUnitId))
      .where(isNull(nomenclature.deletedAt))
      .orderBy(asc(nomenclature.sort), asc(nomenclature.index));
    return rows.map((r) => ({ ...r, orgUnitName: r.orgUnitName ?? null }));
  }

  async create(input: CreateNomenclatureInput, actor: Actor): Promise<NomenclatureDto> {
    const [existing] = await this.db
      .select({ id: nomenclature.id })
      .from(nomenclature)
      .where(and(eq(nomenclature.index, input.index), isNull(nomenclature.deletedAt)));
    if (existing) {
      throw AppException.badRequest(
        'docflow.nomenclature.index_taken',
        'Case index already exists',
      );
    }
    const [created] = await this.db
      .insert(nomenclature)
      .values({
        index: input.index,
        title: input.title,
        orgUnitId: input.orgUnitId ?? null,
        retentionNote: input.retentionNote ?? null,
        sort: input.sort ?? 0,
        isActive: input.isActive ?? true,
        createdBy: actor.id,
      })
      .returning({ id: nomenclature.id });
    if (!created) {
      throw AppException.badRequest(
        'docflow.nomenclature.create_failed',
        'Could not create case index',
      );
    }
    this.audit.log({
      action: 'docflow.nomenclature.created',
      actorId: actor.id,
      entityType: 'nomenclature',
      entityId: created.id,
      meta: { index: input.index },
    });
    return this.getOne(created.id);
  }

  async update(id: string, input: UpdateNomenclatureInput, actor: Actor): Promise<NomenclatureDto> {
    await this.require(id);
    await this.db
      .update(nomenclature)
      .set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.orgUnitId !== undefined ? { orgUnitId: input.orgUnitId ?? null } : {}),
        ...(input.retentionNote !== undefined
          ? { retentionNote: input.retentionNote ?? null }
          : {}),
        ...(input.sort !== undefined ? { sort: input.sort } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      })
      .where(eq(nomenclature.id, id));
    this.audit.log({
      action: 'docflow.nomenclature.updated',
      actorId: actor.id,
      entityType: 'nomenclature',
      entityId: id,
    });
    return this.getOne(id);
  }

  async remove(id: string, actor: Actor): Promise<void> {
    await this.require(id);
    await this.db
      .update(nomenclature)
      .set({ deletedAt: new Date() })
      .where(eq(nomenclature.id, id));
    this.audit.log({
      action: 'docflow.nomenclature.deleted',
      actorId: actor.id,
      entityType: 'nomenclature',
      entityId: id,
    });
  }

  private async require(id: string): Promise<void> {
    const [row] = await this.db
      .select({ id: nomenclature.id })
      .from(nomenclature)
      .where(and(eq(nomenclature.id, id), isNull(nomenclature.deletedAt)))
      .limit(1);
    if (!row) throw AppException.notFound('docflow.nomenclature.not_found', 'Case index not found');
  }

  private async getOne(id: string): Promise<NomenclatureDto> {
    const row = (await this.list()).find((n) => n.id === id);
    if (!row) throw AppException.notFound('docflow.nomenclature.not_found', 'Case index not found');
    return row;
  }
}
