import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import {
  correspondents,
  documentFiles,
  documents,
  fileVersions,
  fsNodes,
  users,
  type Database,
} from '@cuks/db';
import {
  likeStartsWith,
  parseSnippet,
  SNIPPET_END,
  SNIPPET_START,
  type DocumentSearchHitDto,
  type DocumentSearchQuery,
  type PaginatedResult,
  type QuickSearchHitDto,
  type SearchMatchSource,
} from '@cuks/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB } from '../../common/db/db.module';
import { documentOrderBy, parseDocumentSort } from './document-sort';
import { visibleDocumentsWhere } from './document-visibility';
import { RoutesService } from './routes.service';

/**
 * Full-text search over the register (docs/modules/11 §12.13, plan §6.11).
 *
 * Two rules shape every query in this file.
 *
 * **The visibility filter is inside the SQL, never after it** (plan §6.11). Not for tidiness:
 * a search that fetches and then filters gets the count wrong, gets the pagination wrong, and
 * leaks by timing — «сколько всего нашлось» is itself a disclosure, and so is a page that is
 * mysteriously short. `count` and the rows come from the same predicate.
 *
 * **Every branch is separately indexable.** A single OR across the document vector, the
 * attachment vector and a number prefix cannot use any one index, so Postgres would scan the
 * whole register — the exact opposite of what the GIN was added for. The candidates are a
 * UNION of index-friendly branches, deduplicated afterwards (the same shape the file search
 * settled on).
 */
@Injectable()
export class DocumentSearchService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly routes: RoutesService,
  ) {}

  async search(
    query: DocumentSearchQuery,
    actor: AuthUser,
  ): Promise<PaginatedResult<DocumentSearchHitDto>> {
    const assignments = await this.routes.actingAssignments(actor.id);
    const visible = visibleDocumentsWhere(actor, assignments);
    const tsq = sql`websearch_to_tsquery('russian', ${query.q})`;
    const base = and(isNull(documents.deletedAt), visible, ...this.filters(query));
    const matches = this.matchExpression(query.q, tsq);

    const sort = parseDocumentSort(query.sort);
    // `ts_rank_cd` rather than `ts_rank`: cover density rewards documents where the words
    // appear together, which is what «найти по фразе» means to the person typing it.
    const relevance = sql<number>`ts_rank_cd(${documents.searchTsv}, ${tsq})`;
    const offset = (query.page - 1) * query.limit;

    const author = users;
    const [rows, totals] = await Promise.all([
      this.db
        .select({
          id: documents.id,
          regNumber: documents.regNumber,
          subject: documents.subject,
          docClass: documents.docClass,
          typeCode: documents.typeCode,
          status: documents.status,
          confidentiality: documents.confidentiality,
          correspondentName: correspondents.name,
          authorName: author.shortName,
          regDate: documents.regDate,
          createdAt: documents.createdAt,
          // Built ONLY from the document's own fields. `MaxFragments=0` gives one contiguous
          // window rather than a stitched-together set, which reads better and cannot
          // accidentally assemble a whole paragraph out of a confidential body.
          //
          // The highlight markers are control characters, not `<mark>`: `ts_headline` wraps
          // the matched words but does NOT escape the text around them, so returning HTML
          // would hand the client a document's own `<script>` to render. The sentinels are
          // stripped from the source first, so a document cannot forge a highlight either.
          snippet: sql<string | null>`case when ${documents.searchTsv} @@ ${tsq}
            then ts_headline('russian',
              translate(
                coalesce(${documents.subject}, '') || ' — ' ||
                coalesce(${documents.summary}, ${documents.contentText}, ''),
                ${SNIPPET_START + SNIPPET_END}, ''),
              ${tsq},
              ${`StartSel=${SNIPPET_START}, StopSel=${SNIPPET_END}, MaxWords=28, MinWords=8, MaxFragments=0`})
            else null end`,
          hitDocument: sql<boolean>`${documents.searchTsv} @@ ${tsq}`,
          hitNumber: sql<boolean>`(${this.numberMatch(query.q)})`,
          // The correspondent flag is free: the row is already joined. The ATTACHMENT flag is
          // not — re-running the three-table EXISTS per returned row doubles the work of the
          // page — so it is derived instead: the WHERE already proved the row matched
          // somehow, and if none of the cheap surfaces explain it, the attachment did.
          hitCorrespondent: sql<boolean>`(${correspondents.searchTsv} @@ ${tsq})`,
        })
        .from(documents)
        .leftJoin(correspondents, eq(correspondents.id, documents.correspondentId))
        .leftJoin(author, eq(author.id, documents.authorId))
        .where(and(base, matches))
        .orderBy(...documentOrderBy(sort ?? { field: 'relevance', descending: true }, relevance))
        .limit(query.limit)
        .offset(offset),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(documents)
        .where(and(base, matches)),
    ]);

    return {
      items: rows.map((r) => ({
        id: r.id,
        regNumber: r.regNumber,
        subject: r.subject,
        docClass: r.docClass,
        typeCode: r.typeCode,
        status: r.status,
        confidentiality: r.confidentiality,
        correspondentName: r.correspondentName ?? null,
        authorName: r.authorName ?? null,
        regDate: r.regDate?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
        snippet: parseSnippet(r.snippet),
        matchedIn: sources(r),
      })),
      total: totals[0]?.n ?? 0,
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * Cmd+K (plan §8.8): at most five visible documents, number/subject/class/status and
   * nothing else. Deliberately the same predicate and the same match expression as the full
   * search — a palette with its own idea of who may see what is a second policy, and the
   * second one is always the one that leaks.
   */
  async quick(q: string, actor: AuthUser): Promise<QuickSearchHitDto[]> {
    const trimmed = q.trim();
    if (!trimmed) return [];
    const assignments = await this.routes.actingAssignments(actor.id);
    const tsq = sql`websearch_to_tsquery('russian', ${trimmed})`;
    const rows = await this.db
      .select({
        id: documents.id,
        regNumber: documents.regNumber,
        subject: documents.subject,
        docClass: documents.docClass,
        status: documents.status,
      })
      .from(documents)
      .where(
        and(
          isNull(documents.deletedAt),
          visibleDocumentsWhere(actor, assignments),
          this.matchExpression(trimmed, tsq),
        ),
      )
      .orderBy(
        // A pasted registration number should land first, whatever it ranks.
        sql`case when ${this.numberMatch(trimmed)} then 0 else 1 end`,
        sql`ts_rank_cd(${documents.searchTsv}, ${tsq}) desc`,
        sql`${documents.createdAt} desc`,
      )
      .limit(QUICK_LIMIT);
    return rows;
  }

  // --- internals --------------------------------------------------------------------

  /** The whole match, as one OR of independently indexable branches. */
  private matchExpression(q: string, tsq: SQL): SQL {
    return sql`(${documents.searchTsv} @@ ${tsq}
      or ${this.numberMatch(q)}
      or ${this.correspondentMatch(tsq)}
      or ${this.fileMatch(tsq)})`;
  }

  /**
   * A registration number is pasted whole, and `websearch_to_tsquery` does not treat
   * `П-2026/0001` as one token — so the number gets its own anchored prefix branch, which
   * `documents_reg_number_prefix_idx` can serve. Anchored, not `%…%`: an unanchored pattern
   * would give up the index and scan the register on every keystroke.
   */
  private numberMatch(q: string): SQL {
    return sql`${documents.regNumber} is not null
      and upper(${documents.regNumber}) like upper(${likeStartsWith(q)})`;
  }

  private correspondentMatch(tsq: SQL): SQL {
    return sql`exists (select 1 from ${correspondents} c
      where c.id = ${documents.correspondentId} and c.search_tsv @@ ${tsq})`;
  }

  /**
   * The text of the CURRENT version of a currently-attached file, through the index the file
   * module already maintains (plan §6.11 — no second extraction, no second index). Only
   * `is_current` attachments: a word that was in a superseded draft is not in the document.
   */
  private fileMatch(tsq: SQL): SQL {
    return sql`exists (select 1 from ${documentFiles} df
      join ${fsNodes} n on n.id = df.file_id and n.deleted_at is null
      join ${fileVersions} fv on fv.id = n.current_version_id
      where df.document_id = ${documents.id} and df.is_current and fv.extracted_tsv @@ ${tsq})`;
  }

  /** The non-text filters. Every one of them narrows; none can widen what visibility allowed. */
  private filters(query: DocumentSearchQuery): SQL[] {
    const where: SQL[] = [];
    if (query.docClass) where.push(eq(documents.docClass, query.docClass));
    if (query.status) where.push(eq(documents.status, query.status));
    if (query.journalId) where.push(eq(documents.journalId, query.journalId));
    if (query.correspondentId) where.push(eq(documents.correspondentId, query.correspondentId));
    // Half-open on the upper end so «по 31 марта» includes everything registered that day:
    // the column is a timestamp, and `<= '2026-03-31'` would cut the day off at midnight.
    if (query.from) {
      where.push(sql`${documents.regDate} >= (${query.from}::date ${LOCAL_TZ_FROM})`);
    }
    if (query.to) {
      where.push(sql`${documents.regDate} < ((${query.to}::date + 1) ${LOCAL_TZ_FROM})`);
    }
    return where;
  }
}

/** Cmd+K shows five (plan §8.8) — a palette is a shortcut, not a second register. */
const QUICK_LIMIT = 5;

/**
 * A calendar day the user names is a Dushanbe day (CLAUDE.md §2). Inlined as a literal rather
 * than bound, so the expression stays identical everywhere and the planner can still use the
 * index on `reg_date`.
 */
const LOCAL_TZ_FROM = sql.raw("at time zone 'Asia/Dushanbe'");

/** Which surfaces matched, in the order a reader would expect to be told about them. */
function sources(row: {
  hitNumber: boolean;
  hitDocument: boolean;
  hitCorrespondent: boolean | null;
}): SearchMatchSource[] {
  const out: SearchMatchSource[] = [];
  if (row.hitNumber) out.push('number');
  if (row.hitDocument) out.push('document');
  if (row.hitCorrespondent) out.push('correspondent');
  // By elimination. The row is in the result set, so SOMETHING matched; if none of the three
  // surfaces the query already evaluated did, the only remaining branch is the attachment
  // text — and asking the database again for an answer it has already implied is waste.
  if (out.length === 0) out.push('file');
  return out;
}
