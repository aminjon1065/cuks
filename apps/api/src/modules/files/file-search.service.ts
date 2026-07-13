import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, like, or, sql, type SQL } from 'drizzle-orm';
import {
  fileLinkGrants,
  fileLinks,
  fileVersions,
  fsNodes,
  resourceAcl,
  type Database,
} from '@cuks/db';
import type { AvStatus, FsNodeDto, SearchResultDto } from '@cuks/shared';
import { AclService } from '../admin/acl.service';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB } from '../../common/db/db.module';

/** The fs_nodes columns that back an {@link FsNodeDto} — everything except the
 *  large generated `search_tsv` vector, which we never ship to the client. */
const NODE_COLUMNS = {
  id: fsNodes.id,
  parentId: fsNodes.parentId,
  kind: fsNodes.kind,
  name: fsNodes.name,
  space: fsNodes.space,
  ownerUserId: fsNodes.ownerUserId,
  ownerOrgUnitId: fsNodes.ownerOrgUnitId,
  currentVersionId: fsNodes.currentVersionId,
  sizeCached: fsNodes.sizeCached,
  mime: fsNodes.mime,
  tags: fsNodes.tags,
  starredBy: fsNodes.starredBy,
  path: fsNodes.path,
  deletedAt: fsNodes.deletedAt,
  createdAt: fsNodes.createdAt,
  updatedAt: fsNodes.updatedAt,
} as const;

type NodeRow = {
  [K in keyof typeof NODE_COLUMNS]: (typeof fsNodes.$inferSelect)[K];
};

/**
 * File search + recent (docs/modules/12 §2, §6-7; docs/07 §Поиск, task 1.8). Both
 * are scoped to the files the caller may view — the scope is the SQL-set mirror of
 * `FsNodesService.hasAccess(viewer)`: personal ownership, plus any node that is (or
 * descends from) something granted to the user via `resource_acl` (incl. the org
 * root's unit grant, which subsumes org membership) or a still-valid internal link.
 * Reusing the same primitives (`resolveUserSubjects`, path-prefix inheritance) keeps
 * it from diverging into an access-leak.
 */
@Injectable()
export class FileSearchService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly acl: AclService,
  ) {}

  async search(q: string, limit: number, user: AuthUser): Promise<SearchResultDto[]> {
    const query = q.trim();
    if (!query) return [];
    const scope = await this.accessibleFilesCond(user);

    const tsq = sql`websearch_to_tsquery('russian', ${query})`;
    const tagLike = `%${escapeLike(query)}%`;
    const base = sql`${fsNodes.kind} = 'file' and ${fsNodes.deletedAt} is null and ${scope}`;

    // Phase 1 — ranked candidate ids as a UNION of three independently index-
    // friendly branches, so the GIN indexes are actually used. A single OR across
    // fs_nodes.search_tsv, the joined file_versions.extracted_tsv and an unnest/
    // ILIKE forces a full seq scan (no one index satisfies it — review 1.8). The
    // name/text vectors are GIN-scanned per branch; the tag ILIKE branch is a
    // scope-bounded scan (tags can't live in the immutable generated vector).
    const candidates = await this.db.execute<{ id: string; rank: number }>(sql`
      select id, max(rank) as rank from (
        select ${fsNodes.id} as id, ts_rank(${fsNodes.searchTsv}, ${tsq}) as rank
          from ${fsNodes}
          where ${base} and ${fsNodes.searchTsv} @@ ${tsq}
        union all
        select ${fsNodes.id} as id, ts_rank(${fileVersions.extractedTsv}, ${tsq}) as rank
          from ${fsNodes}
          join ${fileVersions} on ${fileVersions.id} = ${fsNodes.currentVersionId}
          where ${base} and ${fileVersions.extractedTsv} @@ ${tsq}
        union all
        select ${fsNodes.id} as id, 0.0::real as rank
          from ${fsNodes}
          where ${base} and exists (select 1 from unnest(${fsNodes.tags}) as tg where tg ilike ${tagLike})
      ) hits
      group by id
      order by rank desc
      limit ${limit}
    `);
    const ranked = candidates.rows;
    if (ranked.length === 0) return [];
    const ids = ranked.map((r) => r.id);
    const rankById = new Map(ranked.map((r) => [r.id, Number(r.rank)]));

    // Phase 2 — hydrate the (already access-scoped) ids with typed columns +
    // avStatus, then restore rank order (updated_at as the tiebreak).
    const rows = await this.db
      .select({ ...NODE_COLUMNS, avStatus: fileVersions.avStatus })
      .from(fsNodes)
      .leftJoin(fileVersions, eq(fileVersions.id, fsNodes.currentVersionId))
      .where(inArray(fsNodes.id, ids));
    rows.sort((a, b) => {
      const byRank = (rankById.get(b.id) ?? 0) - (rankById.get(a.id) ?? 0);
      return byRank !== 0 ? byRank : b.updatedAt.getTime() - a.updatedAt.getTime();
    });

    const locations = await this.buildLocations(rows);
    return rows.map((r) => ({
      ...this.toDto(r, r.avStatus),
      location: locations.get(r.id) ?? null,
    }));
  }

  async recent(limit: number, user: AuthUser): Promise<FsNodeDto[]> {
    const scope = await this.accessibleFilesCond(user);
    const rows = await this.db
      .select({ ...NODE_COLUMNS, avStatus: fileVersions.avStatus })
      .from(fsNodes)
      .leftJoin(fileVersions, eq(fileVersions.id, fsNodes.currentVersionId))
      .where(and(eq(fsNodes.kind, 'file'), isNull(fsNodes.deletedAt), scope))
      .orderBy(desc(fsNodes.updatedAt))
      .limit(limit);
    return rows.map((r) => this.toDto(r, r.avStatus));
  }

  /**
   * SQL condition selecting exactly the file nodes `user` can view. Superadmin:
   * everything. Otherwise: personal files they own, plus any node whose path is —
   * or descends from — a node granted to one of their ACL subjects or an accepted,
   * unexpired link. Grant-to-subtree inheritance is a materialized-path prefix
   * match (`path = grant.path` or `path LIKE grant.path || '.%'`).
   */
  private async accessibleFilesCond(user: AuthUser): Promise<SQL> {
    if (user.isSuperadmin) return sql`true`;

    const { roleIds, orgUnitIds } = await this.acl.resolveUserSubjects(user.id);
    const subjectConds: SQL[] = [
      and(eq(resourceAcl.subjectType, 'user'), eq(resourceAcl.subjectId, user.id)) as SQL,
    ];
    if (roleIds.length) {
      subjectConds.push(
        and(eq(resourceAcl.subjectType, 'role'), inArray(resourceAcl.subjectId, roleIds)) as SQL,
      );
    }
    if (orgUnitIds.length) {
      subjectConds.push(
        and(
          eq(resourceAcl.subjectType, 'org_unit'),
          inArray(resourceAcl.subjectId, orgUnitIds),
        ) as SQL,
      );
    }

    // Node ids granted to me: ACL grants on any of my subjects...
    const aclRows = await this.db
      .selectDistinct({ id: resourceAcl.resourceId })
      .from(resourceAcl)
      .where(and(inArray(resourceAcl.resourceType, ['folder', 'file']), or(...subjectConds)));
    // ...plus links I have accepted that are still valid.
    const linkRows = await this.db
      .selectDistinct({ id: fileLinkGrants.nodeId })
      .from(fileLinkGrants)
      .innerJoin(fileLinks, eq(fileLinks.id, fileLinkGrants.linkId))
      .where(
        and(
          eq(fileLinkGrants.userId, user.id),
          or(isNull(fileLinks.expiresAt), gt(fileLinks.expiresAt, new Date())),
        ),
      );

    const grantedIds = [...new Set([...aclRows, ...linkRows].map((r) => r.id))];
    const personalOwn = and(eq(fsNodes.space, 'personal'), eq(fsNodes.ownerUserId, user.id)) as SQL;

    if (grantedIds.length === 0) return personalOwn;

    // Resolve granted nodes to their materialized paths (a deleted grant node —
    // e.g. a trashed shared folder — confers nothing; its subtree is trashed too).
    const grantedNodes = await this.db
      .select({ path: fsNodes.path })
      .from(fsNodes)
      .where(and(inArray(fsNodes.id, grantedIds), isNull(fsNodes.deletedAt)));
    const paths = grantedNodes.map((n) => n.path);
    if (paths.length === 0) return personalOwn;

    const shareConds: SQL[] = [
      inArray(fsNodes.path, paths), // the granted node itself
      ...paths.map((p) => like(fsNodes.path, `${escapeLike(p)}.%`)), // its descendants
    ];
    return or(personalOwn, ...shareConds) as SQL;
  }

  /** Ancestor-folder breadcrumb per result, batched into one name lookup. */
  private async buildLocations(rows: NodeRow[]): Promise<Map<string, string>> {
    const ancestorIds = new Set<string>();
    for (const r of rows) {
      for (const id of r.path.split('.').slice(0, -1)) ancestorIds.add(id);
    }
    if (ancestorIds.size === 0) return new Map();

    const nameRows = await this.db
      .select({ id: fsNodes.id, name: fsNodes.name })
      .from(fsNodes)
      .where(inArray(fsNodes.id, [...ancestorIds]));
    const nameById = new Map(nameRows.map((n) => [n.id, n.name]));

    const out = new Map<string, string>();
    for (const r of rows) {
      const ancestors = r.path.split('.').slice(0, -1);
      if (ancestors.length === 0) continue;
      out.set(r.id, ancestors.map((id) => nameById.get(id) ?? '?').join(' / '));
    }
    return out;
  }

  private toDto(row: NodeRow, avStatus: AvStatus | null): FsNodeDto {
    return {
      id: row.id,
      parentId: row.parentId,
      kind: row.kind,
      name: row.name,
      space: row.space,
      ownerUserId: row.ownerUserId,
      ownerOrgUnitId: row.ownerOrgUnitId,
      currentVersionId: row.currentVersionId,
      avStatus,
      sizeCached: row.sizeCached,
      mime: row.mime,
      tags: row.tags,
      starredBy: row.starredBy,
      path: row.path,
      deletedAt: row.deletedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/** Escape LIKE metacharacters in a value used inside a LIKE pattern. Paths are
 *  UUIDs (no metachars) but the search term is user input. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}
