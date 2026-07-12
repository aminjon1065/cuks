import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import {
  type Database,
  orgUnits,
  positions,
  rolePermissions,
  roles,
  userPositions,
  userRoles,
  users,
} from '@cuks/db';
import { PERMISSION_WILDCARD, type OrgContext } from '@cuks/shared';
import { DB } from '../../common/db/db.module';

export type UserRow = typeof users.$inferSelect;

export interface UserPermissions {
  permissions: string[];
  isSuperadmin: boolean;
}

/**
 * Reads that authentication/authorization need. Full user CRUD is the admin
 * module (phase 0.12); this stays lean.
 */
@Injectable()
export class UsersService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async findActiveByUsername(username: string): Promise<UserRow | undefined> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.username, username), isNull(users.deletedAt)))
      .limit(1);
    return user;
  }

  async findActiveById(id: string): Promise<UserRow | undefined> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(and(eq(users.id, id), isNull(users.deletedAt)))
      .limit(1);
    return user;
  }

  /** Flat permission set from the user's (non-deleted) roles; wildcard → superadmin. */
  async getPermissions(userId: string): Promise<UserPermissions> {
    const rows = await this.db
      .select({ permission: rolePermissions.permission })
      .from(userRoles)
      .innerJoin(roles, and(eq(roles.id, userRoles.roleId), isNull(roles.deletedAt)))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(eq(userRoles.userId, userId));

    const set = new Set(rows.map((r) => r.permission));
    const isSuperadmin = set.has(PERMISSION_WILDCARD);
    set.delete(PERMISSION_WILDCARD);
    return { permissions: [...set].sort(), isSuperadmin };
  }

  async getOrgContext(userId: string): Promise<OrgContext[]> {
    return this.db
      .select({
        positionId: positions.id,
        positionName: positions.name,
        orgUnitId: orgUnits.id,
        orgUnitName: orgUnits.name,
        isPrimary: userPositions.isPrimary,
        isHead: positions.isHead,
      })
      .from(userPositions)
      .innerJoin(positions, eq(positions.id, userPositions.positionId))
      .innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId))
      .where(eq(userPositions.userId, userId));
  }

  async markLoggedIn(userId: string): Promise<void> {
    await this.db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId));
  }

  async setPassword(userId: string, passwordHash: string): Promise<void> {
    await this.db
      .update(users)
      .set({ passwordHash, mustChangePassword: false })
      .where(eq(users.id, userId));
  }

  async setTotp(userId: string, encryptedSecret: string, enabled: boolean): Promise<void> {
    await this.db
      .update(users)
      .set({ totpSecret: encryptedSecret, totpEnabled: enabled })
      .where(eq(users.id, userId));
  }

  async clearTotp(userId: string): Promise<void> {
    await this.db
      .update(users)
      .set({ totpSecret: null, totpEnabled: false })
      .where(eq(users.id, userId));
  }
}
