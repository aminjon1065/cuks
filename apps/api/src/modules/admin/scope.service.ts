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

export interface RegionScope {
  /** The user sees every territory (superadmin, a global role, or a central unit). */
  global: boolean;
  /** When not global, the `gis.admin_units` ids (regions/districts) the user may see. */
  adminUnitIds: string[];
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

  /**
   * Territory scope for incident data (task 2.13, docs/modules/10 §1). Maps the
   * user's scoped org units to the `gis.admin_units` they cover: superadmin, an
   * unscoped role, or a central unit (no territory) all see everything; a regional
   * управление is confined to its region.
   */
  async getAccessibleRegions(
    user: Pick<AuthUser, 'id' | 'isSuperadmin'>,
    permission: string | readonly string[],
  ): Promise<RegionScope> {
    if (user.isSuperadmin) return { global: true, adminUnitIds: [] };

    // Resolve the scope against the permission(s) that actually gate the caller's
    // endpoint. A module guarded by more than one read permission (e.g. analytics —
    // `analytics.view`/`analytics.build`) must pass all of them, else a user holding
    // one of them but not the probed one resolves to an empty (match-nothing) scope.
    const permissions = typeof permission === 'string' ? [permission] : permission;

    const rows = await this.db
      .select({ orgUnitId: userRoles.orgUnitId, adminUnitId: orgUnits.adminUnitId })
      .from(userRoles)
      .innerJoin(roles, and(eq(roles.id, userRoles.roleId), isNull(roles.deletedAt)))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(orgUnits, and(eq(orgUnits.id, userRoles.orgUnitId), isNull(orgUnits.deletedAt)))
      .where(
        and(
          eq(userRoles.userId, user.id),
          inArray(rolePermissions.permission, [...permissions, PERMISSION_WILDCARD]),
        ),
      );

    if (rows.length === 0) return { global: false, adminUnitIds: [] };
    // A null org-unit scope (global role) or a unit with no territory (the central
    // apparatus) means the user sees all incidents regardless of region.
    if (rows.some((r) => r.orgUnitId === null || r.adminUnitId === null)) {
      return { global: true, adminUnitIds: [] };
    }
    const adminUnitIds = [
      ...new Set(rows.map((r) => r.adminUnitId).filter((v): v is string => v !== null)),
    ];
    return { global: false, adminUnitIds };
  }

  /** All (non-deleted) org-unit ids in the subtrees rooted at the given units. */
  async expandSubtrees(unitIds: string[]): Promise<string[]> {
    if (unitIds.length === 0) return [];
    const roots = await this.db
      .select({ path: orgUnits.path })
      .from(orgUnits)
      .where(and(inArray(orgUnits.id, unitIds), isNull(orgUnits.deletedAt)));
    if (roots.length === 0) return [];

    // `path` is a dot-joined chain of UUIDv7 ids (seed/service), so it contains no
    // LIKE metacharacters — the `${path}.%` prefix match is safe without escaping.
    const conds: SQL[] = [];
    for (const { path } of roots) {
      conds.push(eq(orgUnits.path, path));
      conds.push(like(orgUnits.path, `${path}.%`));
    }
    const descendants = await this.db
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(and(or(...conds), isNull(orgUnits.deletedAt)));
    return [...new Set(descendants.map((d) => d.id))];
  }
}
