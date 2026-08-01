import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, FileStack, FileText, Plus } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { Button, DataTable, EmptyState, FilterBar, PageHeader, StatusBadge, cn } from '@cuks/ui';
import {
  DOC_CLASSES,
  DOCUMENT_STATUSES,
  DOCUMENT_VIEW_PARAMS,
  type DocumentListItemDto,
  type DocumentQueue,
  type ListDocumentsQuery,
} from '@cuks/shared';
import { useCan } from '@/lib/ability';
import { formatDateTime } from '@/lib/format';
import { useDocuments, useJournals, useQueueCounts } from '../api/queries';
import { documentStatusTone } from '../lib/document';
import { CreateDocumentDialog } from '../components/CreateDocumentDialog';
import { TemplatePickerDialog } from '../components/TemplatePickerDialog';
import { QueueRowActions } from '../components/QueueRowActions';
import { SavedViewsBar } from '../components/SavedViewsBar';
import { useDocumentTitle } from '@/lib/use-document-title';

const PAGE_SIZE = 50;
/** Registration years the filter offers — the register started in 2020 and looks one ahead. */
const YEARS = Array.from({ length: new Date().getFullYear() - 2018 }, (_, i) => 2019 + i).reverse();
const selectClass = cn(
  'h-9 rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

export function DocumentsPage(): React.JSX.Element {
  const { t } = useTranslation('docflow');
  useDocumentTitle(t('documents.title'));
  const navigate = useNavigate();
  const canCreate = useCan('docflow.create');
  const canRegister = useCan('docflow.register');
  const canControl = useCan('docflow.control');
  const canRegistry = canRegister || canControl;

  const queues: DocumentQueue[] = [
    'mine',
    'to_approve',
    'to_sign',
    'to_acknowledge',
    'my_tasks',
    'drafts',
    ...(canRegistry ? (['registry'] as const) : []),
  ];
  // Filters live in the URL, so the register is linkable: the dashboard's «Просрочено: 3»
  // opens exactly the three, a colleague can be sent «вот этот срез», and Back means the
  // previous filter rather than the previous page.
  const [params, setParams] = useSearchParams();
  const rawQueue = params.get('queue') ?? 'mine';
  const queue = (queues as readonly string[]).includes(rawQueue)
    ? (rawQueue as DocumentQueue)
    : 'mine';
  const status = params.get('status') ?? '';
  const docClass = params.get('docClass') ?? '';
  const search = params.get('search') ?? '';
  const overdue = params.get('overdue') === 'true';
  const awaitingDispatch = params.get('awaitingDispatch') === 'true';
  const page = Math.max(1, Number(params.get('page') ?? 1));
  const [createOpen, setCreateOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);

  /** Set one filter; any change but paging returns to page 1, because it is a new question. */
  const setParam = (key: string, value: string): void => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
      return next;
    });
  };
  const setQueue = (next: DocumentQueue): void => setParam('queue', next);
  const setStatus = (next: string): void => setParam('status', next);
  const setDocClass = (next: string): void => setParam('docClass', next);
  const setSearch = (next: string): void => setParam('search', next);
  const setPage = (next: number): void => setParam('page', String(next));

  const journalId = params.get('journalId') ?? '';
  const year = params.get('year') ?? '';
  const journals = useJournals();

  const query: ListDocumentsQuery = {
    page,
    limit: PAGE_SIZE,
    queue,
    ...(status ? { status: status as ListDocumentsQuery['status'] } : {}),
    ...(docClass ? { docClass: docClass as ListDocumentsQuery['docClass'] } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(journalId ? { journalId } : {}),
    ...(year ? { year: Number(year) } : {}),
    ...(overdue ? { overdue: true } : {}),
    ...(awaitingDispatch ? { awaitingDispatch: true } : {}),
  };

  /**
   * The filters exactly as a saved view stores them — the URL minus paging. `page` is deliberately
   * excluded: «страница 3» is where you were, not what you were looking for.
   */
  const viewParams: Record<string, string> = Object.fromEntries(
    DOCUMENT_VIEW_PARAMS.map((k) => [k, params.get(k) ?? '']).filter(([, v]) => v !== ''),
  );
  const applyView = (next: Record<string, string>): void => {
    const p = new URLSearchParams();
    for (const key of DOCUMENT_VIEW_PARAMS) if (next[key]) p.set(key, next[key]);
    setParams(p);
  };
  const resetFilters = (): void => setParams(new URLSearchParams({ queue }));

  /** One removable chip per filter in force — «что именно сейчас применено» in one glance. */
  const chips = [
    ...(status ? [{ key: 'status', label: t(`documentStatus.${status}`) }] : []),
    ...(docClass ? [{ key: 'docClass', label: t(`docClass.${docClass}`) }] : []),
    ...(journalId
      ? [
          {
            key: 'journalId',
            label: journals.data?.find((j) => j.id === journalId)?.name ?? journalId,
          },
        ]
      : []),
    ...(year ? [{ key: 'year', label: year }] : []),
    ...(search.trim() ? [{ key: 'search', label: `«${search.trim()}»` }] : []),
    ...(overdue ? [{ key: 'overdue', label: t('documents.filters.overdue') }] : []),
    ...(awaitingDispatch
      ? [{ key: 'awaitingDispatch', label: t('documents.filters.awaitingDispatch') }]
      : []),
  ].map((c) => ({ ...c, onRemove: () => setParam(c.key, '') }));
  const list = useDocuments(query);
  const counts = useQueueCounts();
  const total = list.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Pending-work badges on the action/task queue tabs (docs/modules/11 §7).
  const queueCount = (key: DocumentQueue): number | undefined => {
    const c = counts.data;
    if (!c) return undefined;
    if (key === 'to_approve') return c.to_approve;
    if (key === 'to_sign') return c.to_sign;
    if (key === 'to_acknowledge') return c.to_acknowledge;
    if (key === 'my_tasks') return c.my_tasks;
    return undefined;
  };
  const isActionQueue = queue === 'to_approve' || queue === 'to_sign' || queue === 'to_acknowledge';

  const columns = useMemo<ColumnDef<DocumentListItemDto, unknown>[]>(
    () => [
      {
        accessorKey: 'regNumber',
        header: t('documents.columns.number'),
        cell: ({ row }) => (
          <span className="font-mono text-xs text-text-muted">
            {row.original.regNumber ?? t('documents.unregistered')}
          </span>
        ),
      },
      {
        accessorKey: 'subject',
        header: t('documents.columns.subject'),
        cell: ({ row }) => (
          <span className="font-medium text-text">
            {row.original.confidentiality === 'dsp' ? (
              <span className="mr-1.5 rounded bg-danger/10 px-1 text-[10px] font-semibold uppercase text-danger">
                {t('documents.dsp')}
              </span>
            ) : null}
            {row.original.subject}
          </span>
        ),
      },
      {
        accessorKey: 'docClass',
        header: t('documents.columns.class'),
        cell: ({ row }) => t(`docClass.${row.original.docClass}`),
      },
      {
        accessorKey: 'status',
        header: t('documents.columns.status'),
        cell: ({ row }) => (
          <StatusBadge
            tone={documentStatusTone[row.original.status]}
            label={t(`documentStatus.${row.original.status}`)}
          />
        ),
      },
      {
        accessorKey: 'authorName',
        header: t('documents.columns.author'),
        cell: ({ row }) => row.original.authorName ?? '—',
      },
      {
        accessorKey: 'createdAt',
        header: t('documents.columns.date'),
        cell: ({ row }) => formatDateTime(row.original.regDate ?? row.original.createdAt),
      },
      ...(isActionQueue
        ? [
            {
              id: 'actions',
              header: '',
              cell: ({ row }: { row: { original: DocumentListItemDto } }) => (
                <QueueRowActions doc={row.original} queue={queue} />
              ),
            },
          ]
        : []),
    ],
    [t, isActionQueue, queue],
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('documents.title')}
        description={t('documents.subtitle')}
        actions={
          canCreate ? (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setTemplateOpen(true)}>
                <FileStack className="size-4" aria-hidden /> {t('templates.pick.action')}
              </Button>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="size-4" /> {t('documents.create.action')}
              </Button>
            </div>
          ) : undefined
        }
      />

      <div role="tablist" className="flex gap-1 border-b border-border">
        {queues.map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={queue === key}
            onClick={() => setQueue(key)}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
              queue === key
                ? 'border-primary text-text'
                : 'border-transparent text-text-muted hover:text-text',
            )}
          >
            {t(`documents.queues.${key}`)}
            {queueCount(key) ? (
              <span className="rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">
                {queueCount(key)}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      <FilterBar
        chips={chips}
        {...(chips.length > 0 ? { onReset: resetFilters } : {})}
        resetLabel={t('documents.filters.reset')}
        removeLabel={(c) => t('documents.filters.remove', { name: c.label })}
      >
        <select
          aria-label={t('documents.columns.status')}
          className={selectClass}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">{t('documents.filters.allStatuses')}</option>
          {DOCUMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`documentStatus.${s}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={t('documents.columns.class')}
          className={selectClass}
          value={docClass}
          onChange={(e) => setDocClass(e.target.value)}
        >
          <option value="">{t('documents.filters.allClasses')}</option>
          {DOC_CLASSES.map((c) => (
            <option key={c} value={c}>
              {t(`docClass.${c}`)}
            </option>
          ))}
        </select>
        {/* The register has always been able to filter by book and by registration year; the
            screen simply never offered it, so the only way in was a hand-built URL. */}
        <select
          aria-label={t('documents.filters.journal')}
          className={selectClass}
          value={journalId}
          onChange={(e) => setParam('journalId', e.target.value)}
        >
          <option value="">{t('documents.filters.allJournals')}</option>
          {(journals.data ?? []).map((j) => (
            <option key={j.id} value={j.id}>
              {j.name}
            </option>
          ))}
        </select>
        <select
          aria-label={t('documents.filters.year')}
          className={selectClass}
          value={year}
          onChange={(e) => setParam('year', e.target.value)}
        >
          <option value="">{t('documents.filters.allYears')}</option>
          {YEARS.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </select>
        <input
          className={cn(selectClass, 'min-w-48 flex-1')}
          placeholder={t('documents.filters.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </FilterBar>

      <SavedViewsBar current={viewParams} onApply={applyView} />

      <DataTable
        labels={{
          table: t('documents.title'),
          previousPage: t('documents.prevPage'),
          nextPage: t('documents.nextPage'),
        }}
        columns={columns}
        data={list.data?.items ?? []}
        loading={list.isLoading}
        error={list.isError ? t('common.loadError') : undefined}
        onRetry={() => void list.refetch()}
        pageSize={PAGE_SIZE}
        onRowClick={(row) => navigate(`/app/docs/${row.id}`)}
        onRowEnter={(row) => navigate(`/app/docs/${row.id}`)}
        empty={
          <EmptyState
            icon={FileText}
            title={t('documents.empty.title')}
            description={t('documents.empty.description')}
            action={
              canCreate ? (
                <Button size="sm" onClick={() => setCreateOpen(true)}>
                  <Plus className="size-4" /> {t('documents.create.action')}
                </Button>
              ) : undefined
            }
          />
        }
      />

      {pageCount > 1 ? (
        <div className="flex items-center justify-end gap-2 text-[13px] text-text-muted">
          <span>{t('documents.pagination', { page, pageCount, total })}</span>
          <Button
            variant="outline"
            size="icon"
            aria-label={t('documents.prevPage')}
            disabled={page <= 1}
            onClick={() => setPage(Math.max(1, page - 1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={t('documents.nextPage')}
            disabled={page >= pageCount}
            onClick={() => setPage(Math.min(pageCount, page + 1))}
          >
            <ChevronRight className="size-4" />
          </Button>
        </div>
      ) : null}

      <CreateDocumentDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => navigate(`/app/docs/${id}`)}
      />
      <TemplatePickerDialog
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        onCreated={(id) => navigate(`/app/docs/${id}`)}
      />
    </div>
  );
}
