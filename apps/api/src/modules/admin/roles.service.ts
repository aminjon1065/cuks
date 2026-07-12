import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { type Database, rolePermissions, roles } from '@cuks/db';
import type { CreateRoleInput, RoleDto, UpdateRoleInput } from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';

type Actor = Pick<AuthUser, 'id' | 'permissions' | 'isSuperadmin'>;

/** Role + permission management (docs/05 §5, docs/16 §3). `admin.roles.manage`. */
@Injectable()
export class RolesService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<RoleDto[]> {
    const roleRows = await this.db
      .select()
      .from(roles)
      .where(isNull(roles.deletedAt))
      .orderBy(roles.name);
    const permsByRole = await this.permissionsByRole(roleRows.map((r) => r.id));
    return roleRows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      isSystem: r.isSystem,
      permissions: (permsByRole.get(r.id) ?? []).sort(),
    }));
  }

  async create(input: CreateRoleInput, actor: Actor): Promise<RoleDto> {
    this.assertMayGrant(actor, input.permissions);
    // Only guard against live codes; the partial unique index allows reusing a
    // soft-deleted role's code.
    const [existing] = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.code, input.code), isNull(roles.deletedAt)));
    if (existing)
      throw AppException.badRequest('admin.role.code_taken', 'Role code already exists');

    const id = await this.db.transaction(async (tx) => {
      const [role] = await tx
        .insert(roles)
        .values({ code: input.code, name: input.name, isSystem: false, createdBy: actor.id })
        .returning({ id: roles.id });
      if (!role) throw AppException.badRequest('admin.role.create_failed', 'Could not create role');
      await this.replacePermissions(tx, role.id, input.permissions);
      return role.id;
    });
    this.audit.log({
      action: 'admin.role.created',
      actorId: actor.id,
      entityType: 'role',
      entityId: id,
    });
    return this.getOne(id);
  }

  async update(id: string, input: UpdateRoleInput, actor: Actor): Promise<RoleDto> {
    const role = await this.requireRole(id);
    if (role.isSystem) {
      throw AppException.forbidden('admin.role.system_readonly', 'System roles are read-only');
    }
    if (input.permissions !== undefined) this.assertMayGrant(actor, input.permissions);

    await this.db.transaction(async (tx) => {
      if (input.name !== undefined) {
        await tx.update(roles).set({ name: input.name }).where(eq(roles.id, id));
      }
      if (input.permissions !== undefined) {
        await this.replacePermissions(tx, id, input.permissions);
      }
    });
    this.audit.log({
      action: 'admin.role.updated',
      actorId: actor.id,
      entityType: 'role',
      entityId: id,
    });
    return this.getOne(id);
  }

  async remove(id: string, actor: Actor): Promise<void> {
    const role = await this.requireRole(id);
    if (role.isSystem) {
      throw AppException.forbidden(
        'admin.role.system_undeletable',
        'System roles cannot be deleted',
      );
    }
    await this.db.update(roles).set({ deletedAt: new Date() }).where(eq(roles.id, id));
    this.audit.log({
      action: 'admin.role.deleted',
      actorId: actor.id,
      entityType: 'role',
      entityId: id,
    });
  }

  /** An actor may only grant permissions it already holds (privilege-bounded delegation). */
  private assertMayGrant(actor: Actor, permissions: string[]): void {
    if (actor.isSuperadmin) return;
    const held = new Set(actor.permissions);
    const excess = permissions.filter((p) => !held.has(p));
    if (excess.length > 0) {
      throw AppException.forbidden(
        'admin.role.permission_exceeds_grant',
        `Cannot grant permissions you do not hold: ${excess.join(', ')}`,
      );
    }
  }

  private async replacePermissions(
    tx: Database,
    roleId: string,
    permissions: string[],
  ): Promise<void> {
    await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
    const unique = [...new Set(permissions)];
    if (unique.length === 0) return;
    await tx
      .insert(rolePermissions)
      .values(unique.map((permission) => ({ roleId, permission })))
      .onConflictDoNothing();
  }

  private async permissionsByRole(roleIds: string[]): Promise<Map<string, string[]>> {
    const byRole = new Map<string, string[]>();
    if (roleIds.length === 0) return byRole;
    const perms = await this.db
      .select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(inArray(rolePermissions.roleId, roleIds));
    for (const p of perms) {
      const list = byRole.get(p.roleId) ?? [];
      list.push(p.permission);
      byRole.set(p.roleId, list);
    }
    return byRole;
  }

  private async requireRole(id: string): Promise<typeof roles.$inferSelect> {
    const [role] = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.id, id), isNull(roles.deletedAt)))
      .limit(1);
    if (!role) throw AppException.notFound('admin.role.not_found', 'Role not found');
    return role;
  }

  private async getOne(id: string): Promise<RoleDto> {
    const role = await this.requireRole(id);
    const perms = await this.db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, id));
    return {
      id: role.id,
      code: role.code,
      name: role.name,
      isSystem: role.isSystem,
      permissions: perms.map((p) => p.permission).sort(),
    };
  }
}
