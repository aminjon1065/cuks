import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { type Database, orgUnits, roles, userRoles, users } from '@cuks/db';
import type { AssignRoleInput, RoleAssignmentDto } from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';

/** Assigning role templates to users, optionally scoped to an org unit (docs/05 §3). */
@Injectable()
export class RoleAssignmentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async listByUser(userId: string): Promise<RoleAssignmentDto[]> {
    return this.db
      .select({
        id: userRoles.id,
        userId: userRoles.userId,
        roleId: userRoles.roleId,
        roleCode: roles.code,
        roleName: roles.name,
        orgUnitId: userRoles.orgUnitId,
        orgUnitName: orgUnits.name,
      })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(orgUnits, eq(orgUnits.id, userRoles.orgUnitId))
      .where(eq(userRoles.userId, userId));
  }

  async assign(input: AssignRoleInput, actorId: string): Promise<RoleAssignmentDto> {
    const orgUnitId = input.orgUnitId ?? null;

    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, input.userId), isNull(users.deletedAt)))
      .limit(1);
    if (!user) throw AppException.notFound('admin.user.not_found', 'User not found');

    const [role] = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.id, input.roleId), isNull(roles.deletedAt)))
      .limit(1);
    if (!role) throw AppException.notFound('admin.role.not_found', 'Role not found');

    if (orgUnitId) {
      const [unit] = await this.db
        .select({ id: orgUnits.id })
        .from(orgUnits)
        .where(eq(orgUnits.id, orgUnitId))
        .limit(1);
      if (!unit) throw AppException.notFound('admin.org_unit.not_found', 'Org unit not found');
    }

    const [row] = await this.db
      .insert(userRoles)
      .values({ userId: input.userId, roleId: input.roleId, orgUnitId, createdBy: actorId })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      throw AppException.badRequest(
        'admin.role_assignment.duplicate',
        'Role already assigned in this scope',
      );
    }
    this.audit.log({
      action: 'admin.role.assigned',
      actorId,
      entityType: 'user',
      entityId: input.userId,
      orgUnitId,
      meta: { roleId: input.roleId },
    });
    const [dto] = await this.db
      .select({
        id: userRoles.id,
        userId: userRoles.userId,
        roleId: userRoles.roleId,
        roleCode: roles.code,
        roleName: roles.name,
        orgUnitId: userRoles.orgUnitId,
        orgUnitName: orgUnits.name,
      })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(orgUnits, eq(orgUnits.id, userRoles.orgUnitId))
      .where(eq(userRoles.id, row.id));
    if (!dto)
      throw AppException.notFound('admin.role_assignment.not_found', 'Assignment not found');
    return dto;
  }

  async revoke(id: string, actorId: string): Promise<void> {
    const [removed] = await this.db
      .delete(userRoles)
      .where(eq(userRoles.id, id))
      .returning({ userId: userRoles.userId, roleId: userRoles.roleId });
    if (!removed) {
      throw AppException.notFound('admin.role_assignment.not_found', 'Assignment not found');
    }
    this.audit.log({
      action: 'admin.role.unassigned',
      actorId,
      entityType: 'user',
      entityId: removed.userId,
      meta: { roleId: removed.roleId },
    });
  }
}
