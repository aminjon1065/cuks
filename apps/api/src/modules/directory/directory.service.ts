import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, isNull, or } from 'drizzle-orm';
import { orgUnits, users, type Database } from '@cuks/db';
import type { DirectoryOrgUnitDto, DirectoryUserDto } from '@cuks/shared';
import { DB } from '../../common/db/db.module';

const USER_LIMIT = 20;

/**
 * People/org-unit directory (task 1.5) — a lightweight lookup backing pickers
 * (file sharing, and later chat/tasks/docs). Returns only display identifiers
 * that are already visible on the org chart.
 */
@Injectable()
export class DirectoryService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async searchUsers(q: string | undefined): Promise<DirectoryUserDto[]> {
    // Only active accounts — a blocked user shouldn't surface in pickers as a
    // valid share/assign target (mirrors org-units.service.ts's people listing).
    const conds = [isNull(users.deletedAt), eq(users.status, 'active')];
    if (q) {
      const pattern = `%${q}%`;
      conds.push(
        or(
          ilike(users.fullName, pattern),
          ilike(users.shortName, pattern),
          ilike(users.username, pattern),
        )!,
      );
    }
    const rows = await this.db
      .select({
        id: users.id,
        fullName: users.fullName,
        shortName: users.shortName,
        username: users.username,
      })
      .from(users)
      .where(and(...conds))
      .orderBy(asc(users.shortName))
      .limit(USER_LIMIT);
    return rows;
  }

  async listOrgUnits(): Promise<DirectoryOrgUnitDto[]> {
    return this.db
      .select({ id: orgUnits.id, name: orgUnits.name, path: orgUnits.path })
      .from(orgUnits)
      .where(isNull(orgUnits.deletedAt))
      .orderBy(asc(orgUnits.path));
  }
}
