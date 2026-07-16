import { Inject, Injectable } from '@nestjs/common';
import { aliasedTable, and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { substitutions, users, type Database } from '@cuks/db';
import type { CreateSubstitutionInput, SubstitutionDto } from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';

const principal = aliasedTable(users, 'sub_principal');
const deputy = aliasedTable(users, 'sub_deputy');

const MANAGE = 'admin.substitutions.manage';

/**
 * Substitutions / deputies (docs/05-auth-rbac.md §6, task 3.11). Owns the CRUD (a principal
 * delegating their own duties, or an admin) and the `activePrincipalsFor` lookup that lets the
 * route engine fold a deputy's principals into the acting-assignment resolution.
 */
@Injectable()
export class SubstitutionsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Principal ids the deputy is an ACTIVE substitute for right now (docflow or all scope). The
   *  route engine unions these principals' assignments into what the deputy may act on. */
  async activePrincipalsFor(deputyId: string, now: Date): Promise<string[]> {
    const rows = await this.db
      .select({ principalId: substitutions.principalId })
      .from(substitutions)
      .where(
        and(
          eq(substitutions.deputyId, deputyId),
          eq(substitutions.isActive, true),
          isNull(substitutions.deletedAt),
          or(isNull(substitutions.startsAt), lte(substitutions.startsAt, now)),
          or(isNull(substitutions.endsAt), gte(substitutions.endsAt, now)),
        ),
      );
    return [...new Set(rows.map((r) => r.principalId))];
  }

  /** Substitutions the caller is party to (principal or deputy); an admin may pass `principalId`
   *  to view anyone's. */
  async list(user: AuthUser, principalId?: string): Promise<SubstitutionDto[]> {
    const canManage = user.isSuperadmin || user.permissions.includes(MANAGE);
    let scope;
    if (principalId) {
      if (!canManage && principalId !== user.id) {
        throw AppException.forbidden('docflow.substitution.forbidden', 'Not allowed');
      }
      scope = eq(substitutions.principalId, principalId);
    } else if (canManage) {
      scope = undefined;
    } else {
      scope = or(eq(substitutions.principalId, user.id), eq(substitutions.deputyId, user.id));
    }
    const rows = await this.rows(and(isNull(substitutions.deletedAt), scope));
    const now = new Date();
    return rows.map((r) => this.toDto(r, now));
  }

  async create(input: CreateSubstitutionInput, user: AuthUser): Promise<SubstitutionDto> {
    const canManage = user.isSuperadmin || user.permissions.includes(MANAGE);
    // A leader may delegate only their OWN duties; an admin may set up anyone's.
    if (!canManage && input.principalId !== user.id) {
      throw AppException.forbidden(
        'docflow.substitution.forbidden',
        'You may only delegate your own duties',
      );
    }
    const [created] = await this.db
      .insert(substitutions)
      .values({
        principalId: input.principalId,
        deputyId: input.deputyId,
        scope: input.scope,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        createdBy: user.id,
      })
      .returning({ id: substitutions.id });
    this.audit.log({
      action: 'auth.substitution.created',
      actorId: user.id,
      entityType: 'user',
      entityId: input.principalId,
      meta: { substitutionId: created!.id, deputyId: input.deputyId, scope: input.scope },
    });
    const [row] = await this.rows(eq(substitutions.id, created!.id));
    return this.toDto(row!, new Date());
  }

  /** Soft-delete a substitution — its owner-principal or an admin. */
  async remove(id: string, user: AuthUser): Promise<void> {
    const [row] = await this.db
      .select({ principalId: substitutions.principalId })
      .from(substitutions)
      .where(and(eq(substitutions.id, id), isNull(substitutions.deletedAt)))
      .limit(1);
    const canManage = user.isSuperadmin || user.permissions.includes(MANAGE);
    if (!row || (!canManage && row.principalId !== user.id)) {
      throw AppException.notFound('docflow.substitution.not_found', 'Substitution not found');
    }
    await this.db
      .update(substitutions)
      .set({ isActive: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(substitutions.id, id));
    this.audit.log({
      action: 'auth.substitution.revoked',
      actorId: user.id,
      entityType: 'user',
      entityId: row.principalId,
      meta: { substitutionId: id },
    });
  }

  private rows(where: ReturnType<typeof and>) {
    return this.db
      .select({
        id: substitutions.id,
        principalId: substitutions.principalId,
        principalName: principal.shortName,
        deputyId: substitutions.deputyId,
        deputyName: deputy.shortName,
        scope: substitutions.scope,
        startsAt: substitutions.startsAt,
        endsAt: substitutions.endsAt,
        isActive: substitutions.isActive,
        createdAt: substitutions.createdAt,
      })
      .from(substitutions)
      .leftJoin(principal, eq(principal.id, substitutions.principalId))
      .leftJoin(deputy, eq(deputy.id, substitutions.deputyId))
      .where(where)
      .orderBy(desc(substitutions.createdAt));
  }

  private toDto(
    r: {
      id: string;
      principalId: string;
      principalName: string | null;
      deputyId: string;
      deputyName: string | null;
      scope: SubstitutionDto['scope'];
      startsAt: Date | null;
      endsAt: Date | null;
      isActive: boolean;
      createdAt: Date;
    },
    now: Date,
  ): SubstitutionDto {
    const inWindow =
      (!r.startsAt || r.startsAt <= now) && (!r.endsAt || r.endsAt >= now) && r.isActive;
    return {
      id: r.id,
      principalId: r.principalId,
      principalName: r.principalName,
      deputyId: r.deputyId,
      deputyName: r.deputyName,
      scope: r.scope,
      startsAt: r.startsAt?.toISOString() ?? null,
      endsAt: r.endsAt?.toISOString() ?? null,
      isActive: r.isActive,
      active: inWindow,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
