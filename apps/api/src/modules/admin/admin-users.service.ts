import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, inArray, isNull, or, type SQL } from 'drizzle-orm';
import {
  type Database,
  orgUnits,
  positions,
  roles,
  userPositions,
  userRoles,
  users,
} from '@cuks/db';
import {
  wsRooms,
  type CreateUserInput,
  type ListUsersQuery,
  type PaginatedResult,
  type TempPasswordDto,
  type UpdateUserInput,
  type UserDetailDto,
  type UserListItemDto,
  type UserPositionSummary,
  type UserRoleSummary,
} from '@cuks/shared';
import { AuditService } from '../../common/audit/audit.service';
import { DB } from '../../common/db/db.module';
import { AppException } from '../../common/exceptions/app.exception';
import type { AuthUser } from '../../common/auth/auth-user';
import { PasswordService } from '../auth/password.service';
import { SessionService } from '../auth/session.service';
import { UsersService } from '../users/users.service';
import { RealtimeService } from '../events/realtime.service';
import { generateTempPassword, shortNameFromFullName, usernameBase } from './user-identity';

/**
 * User administration (docs/16 §1). Create generates a translit username + a one-time
 * temporary password (returned once); block/reset revoke sessions and push a forced
 * logout so the target is signed out within seconds (acceptance criteria). Every
 * mutation is audited. All authorization is `admin.users.manage` (enforced on the
 * controller); actor id comes from the request context.
 */
@Injectable()
export class AdminUsersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly usersService: UsersService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  async list(query: ListUsersQuery): Promise<PaginatedResult<UserListItemDto>> {
    const filters: SQL[] = [isNull(users.deletedAt)];
    if (query.status) filters.push(eq(users.status, query.status));
    if (query.search) {
      const s = `%${query.search}%`;
      const term = or(ilike(users.fullName, s), ilike(users.username, s));
      if (term) filters.push(term);
    }
    const where = and(...filters);

    const [totalRow] = await this.db.select({ total: count() }).from(users).where(where);
    const rows = await this.db
      .select({
        id: users.id,
        username: users.username,
        fullName: users.fullName,
        shortName: users.shortName,
        email: users.email,
        status: users.status,
        totpEnabled: users.totpEnabled,
        lastLoginAt: users.lastLoginAt,
      })
      .from(users)
      .where(where)
      .orderBy(desc(users.createdAt))
      .limit(query.limit)
      .offset((query.page - 1) * query.limit);

    const ids = rows.map((r) => r.id);
    const primaryByUser = await this.primaryPositions(ids);
    const rolesByUser = await this.roleNames(ids);

    return {
      items: rows.map((r) => ({
        id: r.id,
        username: r.username,
        fullName: r.fullName,
        shortName: r.shortName,
        email: r.email,
        status: r.status,
        totpEnabled: r.totpEnabled,
        lastLoginAt: r.lastLoginAt ? r.lastLoginAt.toISOString() : null,
        primaryPosition: primaryByUser.get(r.id) ?? null,
        roles: rolesByUser.get(r.id) ?? [],
      })),
      total: totalRow?.total ?? 0,
      page: query.page,
      limit: query.limit,
    };
  }

  async getDetail(id: string): Promise<UserDetailDto> {
    const [row] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    if (!row) throw AppException.notFound('admin.user.not_found', 'User not found');

    const positionRows = await this.db
      .select({
        id: userPositions.id,
        positionId: userPositions.positionId,
        positionName: positions.name,
        orgUnitId: positions.orgUnitId,
        orgUnitName: orgUnits.name,
        isPrimary: userPositions.isPrimary,
      })
      .from(userPositions)
      .innerJoin(positions, eq(positions.id, userPositions.positionId))
      .innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId))
      .where(eq(userPositions.userId, id));

    const roleRows = await this.db
      .select({
        id: userRoles.id,
        roleId: userRoles.roleId,
        roleName: roles.name,
        orgUnitId: userRoles.orgUnitId,
        orgUnitName: orgUnits.name,
      })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(orgUnits, eq(orgUnits.id, userRoles.orgUnitId))
      .where(eq(userRoles.userId, id));

    return {
      id: row.id,
      username: row.username,
      fullName: row.fullName,
      shortName: row.shortName,
      email: row.email,
      phone: row.phone,
      status: row.status,
      totpEnabled: row.totpEnabled,
      mustChangePassword: row.mustChangePassword,
      lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
      positions: positionRows.map((p): UserPositionSummary => ({ ...p })),
      roles: roleRows.map((r): UserRoleSummary => ({ ...r })),
    };
  }

  async create(input: CreateUserInput, actor: AuthUser): Promise<TempPasswordDto> {
    const username = await this.uniqueUsername(usernameBase(input.fullName));
    const tempPassword = generateTempPassword();
    const passwordHash = await this.passwords.hash(tempPassword);
    const [row] = await this.db
      .insert(users)
      .values({
        username,
        passwordHash,
        fullName: input.fullName,
        shortName: shortNameFromFullName(input.fullName),
        email: input.email ?? null,
        phone: input.phone ?? null,
        mustChangePassword: true,
        createdBy: actor.id,
      })
      .returning({ id: users.id });
    if (!row) throw AppException.badRequest('admin.user.create_failed', 'Could not create user');
    this.audit.log({ action: 'admin.user.created', entityType: 'user', entityId: row.id });
    return { id: row.id, username, tempPassword };
  }

  async update(id: string, input: UpdateUserInput, actor: AuthUser): Promise<void> {
    await this.requireUser(id);
    await this.assertMayManage(id, actor);
    const patch: Record<string, unknown> = {};
    if (input.fullName !== undefined) {
      patch['fullName'] = input.fullName;
      patch['shortName'] = shortNameFromFullName(input.fullName);
    }
    if (input.email !== undefined) patch['email'] = input.email;
    if (input.phone !== undefined) patch['phone'] = input.phone;
    if (Object.keys(patch).length === 0) return;
    await this.db.update(users).set(patch).where(eq(users.id, id));
    this.audit.log({ action: 'admin.user.updated', entityType: 'user', entityId: id });
  }

  async block(id: string, actor: AuthUser): Promise<void> {
    if (id === actor.id) {
      throw AppException.badRequest('admin.user.self_block', 'You cannot block yourself');
    }
    await this.requireUser(id);
    await this.assertMayManage(id, actor);
    await this.db.update(users).set({ status: 'blocked' }).where(eq(users.id, id));
    await this.forceLogout(id, 'blocked');
    this.audit.log({ action: 'admin.user.blocked', entityType: 'user', entityId: id });
  }

  async unblock(id: string, actor: AuthUser): Promise<void> {
    await this.requireUser(id);
    await this.assertMayManage(id, actor);
    await this.db.update(users).set({ status: 'active' }).where(eq(users.id, id));
    this.audit.log({ action: 'admin.user.unblocked', entityType: 'user', entityId: id });
  }

  async resetPassword(id: string, actor: AuthUser): Promise<TempPasswordDto> {
    const user = await this.requireUser(id);
    await this.assertMayManage(id, actor);
    const tempPassword = generateTempPassword();
    await this.usersService.setPassword(id, await this.passwords.hash(tempPassword));
    // setPassword clears mustChangePassword — re-arm it so they must change the temp one.
    await this.db.update(users).set({ mustChangePassword: true }).where(eq(users.id, id));
    await this.forceLogout(id, 'password_reset');
    this.audit.log({ action: 'admin.user.password_reset', entityType: 'user', entityId: id });
    return { id, username: user.username, tempPassword };
  }

  async resetTotp(id: string, actor: AuthUser): Promise<void> {
    await this.requireUser(id);
    await this.assertMayManage(id, actor);
    await this.usersService.clearTotp(id);
    this.audit.log({ action: 'admin.user.totp_reset', entityType: 'user', entityId: id });
  }

  async remove(id: string, actor: AuthUser): Promise<void> {
    if (id === actor.id) {
      throw AppException.badRequest('admin.user.self_delete', 'You cannot delete yourself');
    }
    await this.requireUser(id);
    await this.assertMayManage(id, actor);
    await this.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, id));
    await this.forceLogout(id, 'deleted');
    this.audit.log({ action: 'admin.user.deleted', entityType: 'user', entityId: id });
  }

  /**
   * Privilege-bounded delegation (docs/05, mirrors role-assignments): a manager who
   * is not a superadmin must not act on a superadmin — otherwise resetting the
   * superadmin's password/2FA would be a path to full escalation.
   */
  private async assertMayManage(targetId: string, actor: AuthUser): Promise<void> {
    if (actor.isSuperadmin) return;
    const { isSuperadmin } = await this.usersService.getPermissions(targetId);
    if (isSuperadmin) {
      throw AppException.forbidden(
        'admin.user.forbidden_target',
        'Only a superadmin can manage a superadmin',
      );
    }
  }

  private async forceLogout(userId: string, reason: string): Promise<void> {
    await this.sessions.revokeAll(userId);
    this.realtime.emitToRoom(wsRooms.user(userId), 'auth.forced_logout', { reason });
  }

  private async requireUser(id: string) {
    const user = await this.usersService.findActiveById(id);
    if (!user) throw AppException.notFound('admin.user.not_found', 'User not found');
    return user;
  }

  private async uniqueUsername(base: string): Promise<string> {
    for (let suffix = 0; suffix < 100; suffix++) {
      const candidate = suffix === 0 ? base : `${base}${suffix + 1}`;
      const [existing] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, candidate))
        .limit(1);
      if (!existing) return candidate;
    }
    return `${base}.${Date.now()}`;
  }

  private async primaryPositions(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({
        userId: userPositions.userId,
        positionName: positions.name,
        orgUnitName: orgUnits.name,
      })
      .from(userPositions)
      .innerJoin(positions, eq(positions.id, userPositions.positionId))
      .innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId))
      .where(and(inArray(userPositions.userId, ids), eq(userPositions.isPrimary, true)));
    return new Map(rows.map((r) => [r.userId, `${r.positionName} · ${r.orgUnitName}`]));
  }

  private async roleNames(ids: string[]): Promise<Map<string, string[]>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ userId: userRoles.userId, roleName: roles.name })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(inArray(userRoles.userId, ids));
    const map = new Map<string, string[]>();
    for (const r of rows) {
      const list = map.get(r.userId) ?? [];
      list.push(r.roleName);
      map.set(r.userId, list);
    }
    return map;
  }
}
