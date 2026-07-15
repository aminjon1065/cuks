import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { journals, orgUnits, type Database } from '@cuks/db';
import type { CreateJournalInput, JournalDto, UpdateJournalInput } from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';

type Actor = Pick<AuthUser, 'id'>;

/** Registration-journal management (docs/modules/11 §3). `docflow.journals.manage`. */
@Injectable()
export class JournalsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<JournalDto[]> {
    const rows = await this.db
      .select({
        id: journals.id,
        code: journals.code,
        name: journals.name,
        docClass: journals.docClass,
        numberTemplate: journals.numberTemplate,
        seqReset: journals.seqReset,
        orgUnitId: journals.orgUnitId,
        orgUnitName: orgUnits.name,
        sort: journals.sort,
        isActive: journals.isActive,
      })
      .from(journals)
      .leftJoin(orgUnits, eq(orgUnits.id, journals.orgUnitId))
      .where(isNull(journals.deletedAt))
      .orderBy(asc(journals.sort), asc(journals.name));
    return rows.map((r) => ({ ...r, orgUnitName: r.orgUnitName ?? null }));
  }

  async create(input: CreateJournalInput, actor: Actor): Promise<JournalDto> {
    // Only guard against live codes; the partial unique index frees a soft-deleted code.
    const [existing] = await this.db
      .select({ id: journals.id })
      .from(journals)
      .where(and(eq(journals.code, input.code), isNull(journals.deletedAt)));
    if (existing) {
      throw AppException.badRequest('docflow.journal.code_taken', 'Journal code already exists');
    }
    const [created] = await this.db
      .insert(journals)
      .values({
        code: input.code,
        name: input.name,
        docClass: input.docClass,
        numberTemplate: input.numberTemplate,
        seqReset: input.seqReset,
        orgUnitId: input.orgUnitId ?? null,
        sort: input.sort ?? 0,
        isActive: input.isActive ?? true,
        createdBy: actor.id,
      })
      .returning({ id: journals.id });
    if (!created) {
      throw AppException.badRequest('docflow.journal.create_failed', 'Could not create journal');
    }
    this.audit.log({
      action: 'docflow.journal.created',
      actorId: actor.id,
      entityType: 'journal',
      entityId: created.id,
      meta: { code: input.code, docClass: input.docClass },
    });
    return this.getOne(created.id);
  }

  async update(id: string, input: UpdateJournalInput, actor: Actor): Promise<JournalDto> {
    await this.require(id);
    await this.db
      .update(journals)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.docClass !== undefined ? { docClass: input.docClass } : {}),
        ...(input.numberTemplate !== undefined ? { numberTemplate: input.numberTemplate } : {}),
        ...(input.seqReset !== undefined ? { seqReset: input.seqReset } : {}),
        ...(input.orgUnitId !== undefined ? { orgUnitId: input.orgUnitId ?? null } : {}),
        ...(input.sort !== undefined ? { sort: input.sort } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      })
      .where(eq(journals.id, id));
    this.audit.log({
      action: 'docflow.journal.updated',
      actorId: actor.id,
      entityType: 'journal',
      entityId: id,
    });
    return this.getOne(id);
  }

  async remove(id: string, actor: Actor): Promise<void> {
    await this.require(id);
    await this.db.update(journals).set({ deletedAt: new Date() }).where(eq(journals.id, id));
    this.audit.log({
      action: 'docflow.journal.deleted',
      actorId: actor.id,
      entityType: 'journal',
      entityId: id,
    });
  }

  private async require(id: string): Promise<typeof journals.$inferSelect> {
    const [row] = await this.db
      .select()
      .from(journals)
      .where(and(eq(journals.id, id), isNull(journals.deletedAt)))
      .limit(1);
    if (!row) throw AppException.notFound('docflow.journal.not_found', 'Journal not found');
    return row;
  }

  private async getOne(id: string): Promise<JournalDto> {
    const [row] = await this.list().then((all) => all.filter((j) => j.id === id));
    if (!row) throw AppException.notFound('docflow.journal.not_found', 'Journal not found');
    return row;
  }
}
