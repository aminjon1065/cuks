import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, type SQL } from 'drizzle-orm';
import { type Database, orgUnits, rolePermissions, roles, userRoles, users } from '@cuks/db';
import { PERMISSION_WILDCARD, type AssignRoleInput, type RoleAssignmentDto } from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';

type Actor = Pick<AuthUser, 'id' | 'permissions' | 'isSuperadmin'>;

/** Assigning role templates to users, optionally scoped to an org unit (docs/05 §3). */
@Injectable()
export class RoleAssignmentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async listByUser(userId: string): Promise<RoleAssignmentDto[]> {
    return this.selectAssignments(eq(userRoles.userId, userId));
  }

  async assign(input: AssignRoleInput, actor: Actor): Promise<RoleAssignmentDto> {
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

    // Privilege-bounded delegation: only superadmin may grant the superadmin
    // (wildcard) role, and a non-superadmin may only grant roles whose permissions
    // are a subset of its own.
    await this.assertMayAssign(actor, input.roleId);

    if (orgUnitId) {
      const [unit] = await this.db
        .select({ id: orgUnits.id })
        .from(orgUnits)
        .where(and(eq(orgUnits.id, orgUnitId), isNull(orgUnits.deletedAt)))
        .limit(1);
      if (!unit) throw AppException.notFound('admin.org_unit.not_found', 'Org unit not found');
    }

    const [row] = await this.db
      .insert(userRoles)
      .values({ userId: input.userId, roleId: input.roleId, orgUnitId, createdBy: actor.id })
      .onConflictDoNothing()
      .returning({ id: userRoles.id });
    if (!row) {
      throw AppException.badRequest(
        'admin.role_assignment.duplicate',
        'Role already assigned in this scope',
      );
    }
    this.audit.log({
      action: 'admin.role.assigned',
      actorId: actor.id,
      entityType: 'user',
      entityId: input.userId,
      orgUnitId,
      meta: { roleId: input.roleId },
    });
    const [dto] = await this.selectAssignments(eq(userRoles.id, row.id));
    if (!dto)
      throw AppException.notFound('admin.role_assignment.not_found', 'Assignment not found');
    return dto;
  }

  async revoke(id: string, actor: Actor): Promise<void> {
    const [assignment] = await this.db
      .select({ roleId: userRoles.roleId, userId: userRoles.userId })
      .from(userRoles)
      .where(eq(userRoles.id, id))
      .limit(1);
    if (!assignment) {
      throw AppException.notFound('admin.role_assignment.not_found', 'Assignment not found');
    }
    // Only superadmin may strip a superadmin (wildcard) assignment.
    if (!actor.isSuperadmin && (await this.roleHasWildcard(assignment.roleId))) {
      throw AppException.forbidden(
        'admin.role_assignment.superadmin_forbidden',
        'Only a superadmin can revoke a superadmin assignment',
      );
    }
    await this.db.delete(userRoles).where(eq(userRoles.id, id));
    this.audit.log({
      action: 'admin.role.unassigned',
      actorId: actor.id,
      entityType: 'user',
      entityId: assignment.userId,
      meta: { roleId: assignment.roleId },
    });
  }

  private async assertMayAssign(actor: Actor, roleId: string): Promise<void> {
    if (actor.isSuperadmin) return;
    const perms = await this.rolePermissionCodes(roleId);
    if (perms.includes(PERMISSION_WILDCARD)) {
      throw AppException.forbidden(
        'admin.role_assignment.superadmin_forbidden',
        'Only a superadmin can assign the superadmin role',
      );
    }
    const held = new Set(actor.permissions);
    const excess = perms.filter((p) => !held.has(p));
    if (excess.length > 0) {
      throw AppException.forbidden(
        'admin.role_assignment.exceeds_grant',
        `Cannot assign a role with permissions you do not hold: ${excess.join(', ')}`,
      );
    }
  }

  private async roleHasWildcard(roleId: string): Promise<boolean> {
    return (await this.rolePermissionCodes(roleId)).includes(PERMISSION_WILDCARD);
  }

  private async rolePermissionCodes(roleId: string): Promise<string[]> {
    const rows = await this.db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId));
    return rows.map((r) => r.permission);
  }

  private selectAssignments(where: SQL): Promise<RoleAssignmentDto[]> {
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
      .where(where);
  }
}
