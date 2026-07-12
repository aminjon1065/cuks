import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, like, or, type SQL } from 'drizzle-orm';
import { type Database, orgUnits, rolePermissions, roles, userRoles } from '@cuks/db';
import { PERMISSION_WILDCARD } from '@cuks/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB } from '../../common/db/db.module';

export interface PermissionScope {
  /** The permission applies everywhere (superadmin or a global-scoped role). */
  global: boolean;
  /** When not global, the org-unit ids (incl. subtrees) the permission covers. */
  orgUnitIds: string[];
}

/**
 * Level-2 data scoping (docs/05 §3). Resolves which org units a user may act on
 * for a given permission, expanding each scoped unit to its subtree via the
 * materialized `path`. Module services use this to filter list queries.
 */
@Injectable()
export class ScopeService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async getAccessibleOrgUnits(
    user: Pick<AuthUser, 'id' | 'isSuperadmin'>,
    permission: string,
  ): Promise<PermissionScope> {
    if (user.isSuperadmin) return { global: true, orgUnitIds: [] };

    const rows = await this.db
      .select({ orgUnitId: userRoles.orgUnitId })
      .from(userRoles)
      .innerJoin(roles, and(eq(roles.id, userRoles.roleId), isNull(roles.deletedAt)))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .where(
        and(
          eq(userRoles.userId, user.id),
          inArray(rolePermissions.permission, [permission, PERMISSION_WILDCARD]),
        ),
      );

    if (rows.length === 0) return { global: false, orgUnitIds: [] };
    // A null scope means the permission is held globally.
    if (rows.some((r) => r.orgUnitId === null)) return { global: true, orgUnitIds: [] };

    const scopedIds = [
      ...new Set(rows.map((r) => r.orgUnitId).filter((v): v is string => v !== null)),
    ];
    const orgUnitIds = await this.expandSubtrees(scopedIds);
    return { global: false, orgUnitIds };
  }

  /** All org-unit ids in the subtrees rooted at the given units (incl. themselves). */
  async expandSubtrees(unitIds: string[]): Promise<string[]> {
    if (unitIds.length === 0) return [];
    const roots = await this.db
      .select({ path: orgUnits.path })
      .from(orgUnits)
      .where(inArray(orgUnits.id, unitIds));
    if (roots.length === 0) return [];

    const conds: SQL[] = [];
    for (const { path } of roots) {
      conds.push(eq(orgUnits.path, path));
      conds.push(like(orgUnits.path, `${path}.%`));
    }
    const descendants = await this.db
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(or(...conds));
    return descendants.map((d) => d.id);
  }
}
