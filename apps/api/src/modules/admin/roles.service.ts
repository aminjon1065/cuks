import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { type Database, rolePermissions, roles } from '@cuks/db';
import type { CreateRoleInput, RoleDto, UpdateRoleInput } from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import { AppException } from '../../common/exceptions/app.exception';
import { DB } from '../../common/db/db.module';

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
    if (roleRows.length === 0) return [];

    const perms = await this.db
      .select({ roleId: rolePermissions.roleId, permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(
        inArray(
          rolePermissions.roleId,
          roleRows.map((r) => r.id),
        ),
      );
    const byRole = new Map<string, string[]>();
    for (const p of perms) {
      const list = byRole.get(p.roleId) ?? [];
      list.push(p.permission);
      byRole.set(p.roleId, list);
    }
    return roleRows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      isSystem: r.isSystem,
      permissions: (byRole.get(r.id) ?? []).sort(),
    }));
  }

  async create(input: CreateRoleInput, actorId: string): Promise<RoleDto> {
    const [existing] = await this.db
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, input.code));
    if (existing)
      throw AppException.badRequest('admin.role.code_taken', 'Role code already exists');

    const [role] = await this.db
      .insert(roles)
      .values({ code: input.code, name: input.name, isSystem: false, createdBy: actorId })
      .returning();
    if (!role) throw AppException.badRequest('admin.role.create_failed', 'Could not create role');

    await this.setPermissions(role.id, input.permissions);
    this.audit.log({
      action: 'admin.role.created',
      actorId,
      entityType: 'role',
      entityId: role.id,
    });
    return this.getOne(role.id);
  }

  async update(id: string, input: UpdateRoleInput, actorId: string): Promise<RoleDto> {
    const role = await this.requireRole(id);
    if (role.isSystem) {
      throw AppException.forbidden('admin.role.system_readonly', 'System roles are read-only');
    }
    if (input.name !== undefined) {
      await this.db.update(roles).set({ name: input.name }).where(eq(roles.id, id));
    }
    if (input.permissions !== undefined) {
      await this.db.delete(rolePermissions).where(eq(rolePermissions.roleId, id));
      await this.setPermissions(id, input.permissions);
    }
    this.audit.log({ action: 'admin.role.updated', actorId, entityType: 'role', entityId: id });
    return this.getOne(id);
  }

  async remove(id: string, actorId: string): Promise<void> {
    const role = await this.requireRole(id);
    if (role.isSystem) {
      throw AppException.forbidden(
        'admin.role.system_undeletable',
        'System roles cannot be deleted',
      );
    }
    await this.db.update(roles).set({ deletedAt: new Date() }).where(eq(roles.id, id));
    this.audit.log({ action: 'admin.role.deleted', actorId, entityType: 'role', entityId: id });
  }

  private async setPermissions(roleId: string, permissions: string[]): Promise<void> {
    const unique = [...new Set(permissions)];
    if (unique.length === 0) return;
    await this.db
      .insert(rolePermissions)
      .values(unique.map((permission) => ({ roleId, permission })))
      .onConflictDoNothing();
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
    const all = await this.list();
    const role = all.find((r) => r.id === id);
    if (!role) throw AppException.notFound('admin.role.not_found', 'Role not found');
    return role;
  }
}
