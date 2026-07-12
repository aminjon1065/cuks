import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, or, type SQL } from 'drizzle-orm';
import { type Database, positions, resourceAcl, roles, userPositions, userRoles } from '@cuks/db';
import {
  aclLevelSatisfies,
  type AclEntryDto,
  type AclLevel,
  type AclResourceType,
  type GrantAclInput,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';

/**
 * Level-3 resource ACL helpers (docs/05 §3). Access is resolved across three
 * subject kinds: the user directly, their roles, and their org units.
 */
@Injectable()
export class AclService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async grant(input: GrantAclInput, actorId: string): Promise<AclEntryDto> {
    const [row] = await this.db
      .insert(resourceAcl)
      .values({ ...input, createdBy: actorId })
      .onConflictDoUpdate({
        target: [
          resourceAcl.resourceType,
          resourceAcl.resourceId,
          resourceAcl.subjectType,
          resourceAcl.subjectId,
        ],
        set: { level: input.level },
      })
      .returning();
    if (!row) throw AppException.badRequest('acl.grant_failed', 'Could not grant access');
    this.audit.log({
      action: 'acl.granted',
      actorId,
      entityType: input.resourceType,
      entityId: input.resourceId,
      meta: { subjectType: input.subjectType, subjectId: input.subjectId, level: input.level },
    });
    return this.toDto(row);
  }

  async revoke(id: string, actorId: string): Promise<void> {
    const [removed] = await this.db.delete(resourceAcl).where(eq(resourceAcl.id, id)).returning();
    if (!removed) throw AppException.notFound('acl.not_found', 'ACL entry not found');
    this.audit.log({
      action: 'acl.revoked',
      actorId,
      entityType: removed.resourceType,
      entityId: removed.resourceId,
      meta: {
        subjectType: removed.subjectType,
        subjectId: removed.subjectId,
        level: removed.level,
      },
    });
  }

  async listForResource(resourceType: AclResourceType, resourceId: string): Promise<AclEntryDto[]> {
    const rows = await this.db
      .select()
      .from(resourceAcl)
      .where(
        and(eq(resourceAcl.resourceType, resourceType), eq(resourceAcl.resourceId, resourceId)),
      );
    return rows.map((r) => this.toDto(r));
  }

  /** True if the user has at least `minLevel` on the resource (superadmin bypasses). */
  async check(
    user: Pick<AuthUser, 'id' | 'isSuperadmin'>,
    resourceType: AclResourceType,
    resourceId: string,
    minLevel: AclLevel,
  ): Promise<boolean> {
    if (user.isSuperadmin) return true;
    const { roleIds, orgUnitIds } = await this.resolveUserSubjects(user.id);

    const subjectConds: SQL[] = [
      and(eq(resourceAcl.subjectType, 'user'), eq(resourceAcl.subjectId, user.id)) as SQL,
    ];
    if (roleIds.length > 0) {
      subjectConds.push(
        and(eq(resourceAcl.subjectType, 'role'), inArray(resourceAcl.subjectId, roleIds)) as SQL,
      );
    }
    if (orgUnitIds.length > 0) {
      subjectConds.push(
        and(
          eq(resourceAcl.subjectType, 'org_unit'),
          inArray(resourceAcl.subjectId, orgUnitIds),
        ) as SQL,
      );
    }

    const rows = await this.db
      .select({ level: resourceAcl.level })
      .from(resourceAcl)
      .where(
        and(
          eq(resourceAcl.resourceType, resourceType),
          eq(resourceAcl.resourceId, resourceId),
          or(...subjectConds),
        ),
      );
    return rows.some((r) => aclLevelSatisfies(r.level, minLevel));
  }

  /** The user's role ids (non-deleted roles) and directly-held org-unit ids. */
  async resolveUserSubjects(userId: string): Promise<{ roleIds: string[]; orgUnitIds: string[] }> {
    const roleRows = await this.db
      .selectDistinct({ roleId: userRoles.roleId })
      .from(userRoles)
      .innerJoin(roles, and(eq(roles.id, userRoles.roleId), isNull(roles.deletedAt)))
      .where(eq(userRoles.userId, userId));
    const unitRows = await this.db
      .selectDistinct({ orgUnitId: positions.orgUnitId })
      .from(userPositions)
      .innerJoin(
        positions,
        and(eq(positions.id, userPositions.positionId), isNull(positions.deletedAt)),
      )
      .where(eq(userPositions.userId, userId));
    return {
      roleIds: roleRows.map((r) => r.roleId),
      orgUnitIds: unitRows.map((r) => r.orgUnitId),
    };
  }

  private toDto(row: typeof resourceAcl.$inferSelect): AclEntryDto {
    return {
      id: row.id,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      subjectType: row.subjectType,
      subjectId: row.subjectId,
      level: row.level,
    };
  }
}
