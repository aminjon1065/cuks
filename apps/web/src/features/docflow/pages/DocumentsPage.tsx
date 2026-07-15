import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, FileText, Plus } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import { Button, DataTable, EmptyState, PageHeader, StatusBadge, cn } from '@cuks/ui';
import {
  DOC_CLASSES,
  DOCUMENT_STATUSES,
  type DocumentListItemDto,
  type DocumentQueue,
  type ListDocumentsQuery,
} from '@cuks/shared';
import { useCan } from '@/lib/ability';
import { formatDateTime } from '@/lib/format';
import { useDocuments } from '../api/queries';
import { documentStatusTone } from '../lib/document';
import { CreateDocumentDialog } from '../components/CreateDocumentDialog';

const PAGE_SIZE = 50;
const selectClass = cn(
  'h-9 rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

export function DocumentsPage(): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const navigate = useNavigate();
  const canCreate = useCan('docflow.create');
  const canRegister = useCan('docflow.register');
  const canControl = useCan('docflow.control');
  const canRegistry = canRegister || canControl;

  const queues: DocumentQueue[] = [
    'mine',
    'to_approve',
    'to_sign',
    'my_tasks',
    'drafts',
    ...(canRegistry ? (['registry'] as const) : []),
  ];
  const [queue, setQueue] = useState<DocumentQueue>('mine');
  const [status, setStatus] = useState('');
  const [docClass, setDocClass] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);

  const query: ListDocumentsQuery = {
    page,
    limit: PAGE_SIZE,
    queue,
    ...(status ? { status: status as ListDocumentsQuery['status'] } : {}),
    ...(docClass ? { docClass: docClass as ListDocumentsQuery['docClass'] } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
  };
  const list = useDocuments(query);
  const total = list.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
    ],
    [t],
  );

  const resetPageAnd = (fn: () => void) => {
    fn();
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t('documents.title')}
        description={t('documents.subtitle')}
        actions={
          canCreate ? (
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> {t('documents.create.action')}
            </Button>
          ) : undefined
        }
      />

      <div role="tablist" className="flex gap-1 border-b border-border">
        {queues.map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={queue === key}
            onClick={() => resetPageAnd(() => setQueue(key))}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
              queue === key
                ? 'border-primary text-text'
                : 'border-transparent text-text-muted hover:text-text',
            )}
          >
            {t(`documents.queues.${key}`)}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t('documents.columns.status')}
          className={selectClass}
          value={status}
          onChange={(e) => resetPageAnd(() => setStatus(e.target.value))}
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
          onChange={(e) => resetPageAnd(() => setDocClass(e.target.value))}
        >
          <option value="">{t('documents.filters.allClasses')}</option>
          {DOC_CLASSES.map((c) => (
            <option key={c} value={c}>
              {t(`docClass.${c}`)}
            </option>
          ))}
        </select>
        <input
          className={cn(selectClass, 'min-w-48 flex-1')}
          placeholder={t('documents.filters.searchPlaceholder')}
          value={search}
          onChange={(e) => resetPageAnd(() => setSearch(e.target.value))}
        />
      </div>

      <DataTable
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
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={t('documents.nextPage')}
            disabled={page >= pageCount}
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
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
    </div>
  );
}
