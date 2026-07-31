import { asc, desc, sql, type SQL } from 'drizzle-orm';
import { documents } from '@cuks/db';
import { DOCUMENT_SORT_FIELDS, type DocumentSortField } from '@cuks/shared';
import { AppException } from '../../common/exceptions/app.exception';

/**
 * Ordering a document list (docs/04 §Списки, plan §12.1 «search query builder allow-list»).
 *
 * The rule the whole file exists for: **a column name from the client never reaches SQL as a
 * string.** The DTO admits only the names in `DOCUMENT_SORT_FIELDS`, and this table is the
 * only thing that turns one of those names into a column. There is no fallback branch that
 * interpolates the input, so a name nobody added here cannot be sorted by — it is a 422, not
 * a surprise.
 */
const SORTABLE = {
  created_at: documents.createdAt,
  reg_date: documents.regDate,
  due_date: documents.dueDate,
  subject: documents.subject,
  reg_number: documents.regNumber,
  status: documents.status,
} as const satisfies Partial<Record<DocumentSortField, unknown>>;

/** How a parsed sort reads: which field, and which way. */
export interface DocumentSort {
  field: DocumentSortField;
  descending: boolean;
}

export function parseDocumentSort(raw: string | undefined): DocumentSort | null {
  if (!raw) return null;
  const descending = raw.startsWith('-');
  const field = raw.replace(/^-/, '');
  if (!DOCUMENT_SORT_FIELDS.includes(field as DocumentSortField)) {
    // Unreachable through the DTO, which refuses the same set — kept because this function is
    // also the one a future caller will reach for, and it must be safe on its own.
    throw AppException.unprocessable('docflow.search.bad_sort', 'Unsupported sort field', {
      field,
    });
  }
  return { field: field as DocumentSortField, descending };
}

/**
 * The ORDER BY, always ending in `id` — WITHOUT a unique tie-breaker, page 2 of a register
 * where fifty documents were created in the same second is not «the next fifty», it is
 * whatever the planner felt like, and a row can appear on both pages or on neither.
 *
 * `relevance` is not in the column table on purpose: it is not a column but an expression the
 * search builds, so the caller passes it in. Asking for it without a query is refused there.
 */
export const DOCUMENT_TIE_BREAKER = desc(documents.id);

export function documentOrderBy(sort: DocumentSort | null, relevance?: SQL): SQL[] {
  const tieBreaker = DOCUMENT_TIE_BREAKER;
  if (!sort) return [desc(documents.createdAt), tieBreaker];

  if (sort.field === 'relevance') {
    if (!relevance) {
      throw AppException.unprocessable(
        'docflow.search.relevance_without_query',
        'Sorting by relevance needs a search query',
      );
    }
    return [desc(relevance), desc(documents.createdAt), tieBreaker];
  }

  const column = SORTABLE[sort.field];
  // NULLS LAST in both directions: a register sorted by registration date must not open on a
  // page of unregistered drafts, whichever way the user clicked the header.
  const ordered = sort.descending
    ? sql`${desc(column)} nulls last`
    : sql`${asc(column)} nulls last`;
  return [ordered, desc(documents.createdAt), tieBreaker];
}
