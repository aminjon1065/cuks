import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, FileSearch, Paperclip, Search, Users } from 'lucide-react';
import { Button, EmptyState, Input, PageHeader, Skeleton, StatusBadge, cn } from '@cuks/ui';
import { DOCUMENT_SORT_FIELDS, type DocumentSearchHitDto } from '@cuks/shared';
import { formatDateTime } from '@/lib/format';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useDocumentTitle } from '@/lib/use-document-title';
import { useDocumentSearch } from '../api/queries';
import { documentStatusTone } from '../lib/document';

const PAGE_SIZE = 20;
const selectClass = cn(
  'h-9 rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);
/** `relevance` only means something with a query behind it, which this screen always has. */
const SORTS = ['relevance', '-created_at', '-reg_date', 'subject'] as const;

/**
 * Full-text search over the register (plan этап 9).
 *
 * The query lives in the URL, so a search is a link: «посмотри вот это» is the most common
 * thing anybody wants to do with a result, and a box holding its state in React state cannot
 * be sent to a colleague or reopened tomorrow.
 */
export function SearchPage(): React.JSX.Element {
  const { t } = useTranslation('docflow');
  useDocumentTitle(t('search.title'));
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const debounced = useDebouncedValue(query, 300);
  const page = Math.max(1, Number(params.get('page') ?? 1));
  const sort = params.get('sort') ?? 'relevance';

  // The URL follows the debounced value, not the keystroke: one history entry per search, not
  // one per letter, so Back means «предыдущий поиск».
  //
  // Guarded by what is ALREADY in the URL rather than by the effect's own dependencies:
  // react-router hands back a new `setSearchParams` identity every time the query string
  // changes, so an unguarded effect re-fires after every page change and strips `page` again —
  // Next/Prev would advance for one frame and snap back to page 1 forever.
  const urlQuery = params.get('q') ?? '';
  useEffect(() => {
    const next = debounced.trim();
    if (next === urlQuery) return;
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (next) p.set('q', next);
        else p.delete('q');
        // A NEW query starts at page 1; paging within the same query must survive.
        p.delete('page');
        return p;
      },
      { replace: true },
    );
  }, [debounced, urlQuery, setParams]);

  // A `q` written by somebody else — the command palette's «искать во всех документах», a
  // pasted link, the Back button — becomes what the box shows, instead of being overwritten
  // by this component's older local state.
  useEffect(() => {
    setQuery((current) => (urlQuery && urlQuery !== current.trim() ? urlQuery : current));
  }, [urlQuery]);

  const { data, isPending, isError, isFetching, refetch } = useDocumentSearch(debounced, {
    page,
    limit: PAGE_SIZE,
    ...(sort !== 'relevance' ? { sort } : {}),
  });

  const setPage = (next: number): void => {
    setParams((prev) => {
      const p = new URLSearchParams(prev);
      p.set('page', String(next));
      return p;
    });
  };
  const total = data?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const asked = debounced.trim().length > 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('search.title')} description={t('search.description')} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-64 flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-text-muted"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search.placeholder')}
            aria-label={t('search.title')}
            autoFocus
            className="pl-8"
          />
        </div>
        <select
          className={selectClass}
          value={sort}
          aria-label={t('search.sortLabel')}
          onChange={(e) =>
            setParams((prev) => {
              const p = new URLSearchParams(prev);
              p.set('sort', e.target.value);
              p.delete('page');
              return p;
            })
          }
        >
          {SORTS.filter((s) => DOCUMENT_SORT_FIELDS.includes(s.replace(/^-/, '') as never)).map(
            (s) => (
              <option key={s} value={s}>
                {t(`search.sort.${s.replace('-', 'desc_')}`)}
              </option>
            ),
          )}
        </select>
      </div>

      {!asked ? (
        <EmptyState
          icon={FileSearch}
          title={t('search.emptyTitle')}
          description={t('search.emptyHint')}
        />
      ) : isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          icon={FileSearch}
          title={t('search.failedTitle')}
          description={t('search.failedHint')}
          action={
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      ) : total === 0 ? (
        <EmptyState
          icon={FileSearch}
          title={t('search.noResults', { query: debounced.trim() })}
          description={t('search.noResultsHint')}
        />
      ) : (
        <>
          <p className="text-xs text-text-muted" aria-live="polite">
            {t('search.found', { count: total })}
            {isFetching ? ` · ${t('common.loading')}` : ''}
          </p>
          <ul className="flex flex-col gap-2">
            {data.items.map((hit) => (
              <SearchHit key={hit.id} hit={hit} />
            ))}
          </ul>
          {lastPage > 1 ? (
            <div className="flex items-center justify-end gap-2 text-[13px] text-text-muted">
              <Button
                size="sm"
                variant="ghost"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
                aria-label={t('common.prev')}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <span className="tabular-nums">{t('search.page', { page, of: lastPage })}</span>
              <Button
                size="sm"
                variant="ghost"
                disabled={page >= lastPage}
                onClick={() => setPage(page + 1)}
                aria-label={t('common.next')}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function SearchHit({ hit }: { hit: DocumentSearchHitDto }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  return (
    <li className="rounded-md border border-border bg-surface p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <Link to={`/app/docs/${hit.id}`} className="font-medium text-primary hover:underline">
          {hit.subject}
        </Link>
        {hit.regNumber ? (
          <span className="font-mono text-xs text-text-muted">{hit.regNumber}</span>
        ) : null}
        <StatusBadge
          tone={documentStatusTone[hit.status]}
          label={t(`documentStatus.${hit.status}`)}
        />
        {hit.confidentiality === 'dsp' ? (
          <StatusBadge tone="danger" label={t('documents.dsp')} />
        ) : null}
      </div>

      {hit.snippet ? (
        // Segments, not markup. The server sends where the match is; React renders the text.
        // Nothing here interprets document content as HTML, so a subject containing a tag is
        // just a subject containing a tag.
        <p className="mt-1 text-[13px] leading-relaxed text-text-muted">
          {hit.snippet.map((part, i) =>
            part.hit ? (
              <mark key={i} className="rounded-sm bg-warning/25 px-0.5 text-text">
                {part.text}
              </mark>
            ) : (
              <span key={i}>{part.text}</span>
            ),
          )}
        </p>
      ) : null}

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
        {hit.correspondentName ? <span>{hit.correspondentName}</span> : null}
        {hit.authorName ? <span>{hit.authorName}</span> : null}
        {hit.regDate ? <span>{formatDateTime(hit.regDate)}</span> : null}
        {/* Why this row is here at all: a hit whose subject shows none of the searched words
            reads as a bug until the list says the match was inside an attachment. */}
        {hit.matchedIn.includes('file') ? (
          <span className="inline-flex items-center gap-1 text-text">
            <Paperclip className="size-3" aria-hidden /> {t('search.matchedInFile')}
          </span>
        ) : null}
        {hit.matchedIn.includes('correspondent') ? (
          <span className="inline-flex items-center gap-1 text-text">
            <Users className="size-3" aria-hidden /> {t('search.matchedInCorrespondent')}
          </span>
        ) : null}
      </div>
    </li>
  );
}
