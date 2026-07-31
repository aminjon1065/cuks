import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Archive, Download, Lock } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  toast,
} from '@cuks/ui';
import type { ArchiveQuery, DispositionBatchDto } from '@cuks/shared';
import { formatDateTime } from '@/lib/format';
import { useDocumentTitle } from '@/lib/use-document-title';
import {
  useAddDispositionItems,
  useArchive,
  useCreateDispositionBatch,
  useDispositionAction,
  useDispositionBatches,
} from '../api/queries';

const PAGE_SIZE = 50;
const inputClass = cn(
  'h-9 rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

const TABS = ['inventory', 'candidates', 'batches'] as const;
type Tab = (typeof TABS)[number];

/**
 * «Архив» (docs/modules/11 §12.12, plan §8.7): the inventory, the documents whose term has
 * run out, and the acts of disposal.
 *
 * Candidates are a separate tab rather than a filter buried in the inventory, because that
 * list is the one an archivist has to look at deliberately — it is the only place the system
 * proposes losing something, and it should never be reached by accident.
 */
export function ArchivePage(): React.JSX.Element {
  const { t } = useTranslation('docflow');
  useDocumentTitle(t('archivePage.title'));
  const [tab, setTab] = useState<Tab>('inventory');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('archivePage.title')} description={t('archivePage.subtitle')} />
      <div role="tablist" className="flex gap-1 border-b border-border">
        {TABS.map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
              tab === key
                ? 'border-primary text-text'
                : 'border-transparent text-text-muted hover:text-text',
            )}
          >
            {t(`archivePage.tabs.${key}`)}
          </button>
        ))}
      </div>
      {tab === 'batches' ? (
        <BatchesPanel />
      ) : (
        <InventoryPanel candidatesOnly={tab === 'candidates'} />
      )}
    </div>
  );
}

function InventoryPanel({ candidatesOnly }: { candidatesOnly: boolean }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const [search, setSearch] = useState('');
  const [caseIndex, setCaseIndex] = useState('');
  const [page, setPage] = useState(1);
  const [exporting, setExporting] = useState(false);

  const query: ArchiveQuery = useMemo(
    () => ({
      page,
      limit: PAGE_SIZE,
      ...(search ? { search } : {}),
      ...(caseIndex ? { caseIndex } : {}),
      ...(candidatesOnly ? { candidatesOnly: true } : {}),
    }),
    [page, search, caseIndex, candidatesOnly],
  );
  const list = useArchive(query);
  const total = list.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const runExport = async (): Promise<void> => {
    setExporting(true);
    try {
      const params = new URLSearchParams({ page: '1', limit: '200' });
      if (search) params.set('search', search);
      if (caseIndex) params.set('caseIndex', caseIndex);
      if (candidatesOnly) params.set('candidatesOnly', 'true');
      const res = await fetch(`/api/v1/docflow/archive/export?${params.toString()}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`export failed: ${res.status}`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = 'archive.xlsx';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: t('reports.exportFailed'), tone: 'danger' });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {candidatesOnly ? (
        // The one screen where the system proposes losing something: it says so plainly.
        <p role="status" className="rounded-sm bg-warning/10 px-3 py-2 text-[13px] text-warning">
          {t('archivePage.candidatesWarning')}
        </p>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="archive-search">{t('archivePage.search')}</Label>
          <Input
            id="archive-search"
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            className="w-64"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="archive-case">{t('documents.card.caseIndex')}</Label>
          <input
            id="archive-case"
            value={caseIndex}
            onChange={(e) => {
              setPage(1);
              setCaseIndex(e.target.value);
            }}
            className={cn(inputClass, 'w-40 font-mono')}
          />
        </div>
        <Button variant="secondary" onClick={() => void runExport()} disabled={exporting || !total}>
          <Download className="mr-1.5 size-4" />
          {t('archivePage.export')}
        </Button>
      </div>

      {list.isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : list.isError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-[13px] text-danger">{t('common.loadError')}</p>
          <Button variant="ghost" size="sm" onClick={() => void list.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : total === 0 ? (
        <EmptyState
          icon={Archive}
          title={t(candidatesOnly ? 'archivePage.noCandidates.title' : 'archivePage.empty.title')}
          description={t(
            candidatesOnly
              ? 'archivePage.noCandidates.description'
              : 'archivePage.empty.description',
          )}
        />
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-36">{t('reportsAck.columns.regNumber')}</TableHead>
                <TableHead>{t('reportsAck.columns.subject')}</TableHead>
                <TableHead className="w-32">{t('documents.card.caseIndex')}</TableHead>
                <TableHead className="w-40">{t('archive.archivedAt')}</TableHead>
                <TableHead className="w-40">{t('archive.retention')}</TableHead>
                <TableHead className="w-40">{t('archive.disposition')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.data!.items.map((e) => (
                <TableRow key={e.documentId}>
                  <TableCell className="font-mono text-xs">
                    <Link to={`/app/docs/${e.documentId}`} className="text-primary hover:underline">
                      {e.regNumber ?? '—'}
                    </Link>
                  </TableCell>
                  <TableCell className="text-text">
                    {e.subject}
                    {e.legalHold ? (
                      <span className="ml-2 inline-flex items-center gap-1 rounded bg-danger/10 px-1.5 text-[10px] font-semibold uppercase text-danger">
                        <Lock className="size-3" aria-hidden /> {t('archivePage.held')}
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-text-muted">
                    {e.caseIndex ?? '—'}
                  </TableCell>
                  <TableCell className="text-text-muted">
                    {e.archivedAt ? formatDateTime(e.archivedAt) : '—'}
                  </TableCell>
                  <TableCell className="text-text-muted">
                    {e.isPermanent
                      ? t('archive.permanent')
                      : e.retentionUntil
                        ? formatDateTime(e.retentionUntil)
                        : t('archive.noRetention')}
                  </TableCell>
                  <TableCell>
                    <StatusBadge
                      tone={
                        e.dispositionStatus === 'executed'
                          ? 'danger'
                          : e.dispositionStatus === 'candidate'
                            ? 'warning'
                            : 'neutral'
                      }
                      label={t(`dispositionStatus.${e.dispositionStatus}`)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {pageCount > 1 ? (
            <div className="flex items-center justify-end gap-2 text-[13px] text-text-muted">
              <Button
                variant="ghost"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                {t('documents.prevPage')}
              </Button>
              <span>{t('documents.pagination', { page, pageCount, total })}</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => p + 1)}
              >
                {t('documents.nextPage')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function BatchesPanel(): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const batches = useDispositionBatches();
  const create = useCreateDispositionBatch();
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-text-muted">{t('archivePage.batchesHint')}</p>
        <Button size="sm" onClick={() => setCreating(true)}>
          {t('archivePage.newBatch')}
        </Button>
      </div>

      {batches.isPending ? (
        <Skeleton className="h-24 w-full rounded-md" />
      ) : batches.isError ? (
        <EmptyState title={t('common.loadError')} description={t('common.loadErrorHint')} />
      ) : batches.data.length === 0 ? (
        <EmptyState
          icon={Archive}
          title={t('archivePage.noBatches.title')}
          description={t('archivePage.noBatches.description')}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {batches.data.map((b) => (
            <li key={b.id}>
              <BatchCard batch={b} />
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <Dialog open onOpenChange={(o) => !o && setCreating(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('archivePage.newBatch')}</DialogTitle>
            </DialogHeader>
            <BatchForm
              pending={create.isPending}
              onClose={() => setCreating(false)}
              onSubmit={(number, reason) =>
                create.mutate(
                  { number, reason, documentIds: [] },
                  {
                    onSuccess: () => {
                      toast({ title: t('archivePage.batchCreated'), tone: 'success' });
                      setCreating(false);
                    },
                    onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
                  },
                )
              }
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function BatchCard({ batch }: { batch: DispositionBatchDto }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const act = useDispositionAction();
  const addItems = useAddDispositionItems();
  const [adding, setAdding] = useState(false);
  const [confirmingExecute, setConfirmingExecute] = useState(false);

  const run = (action: 'submit' | 'approve' | 'reject' | 'execute') =>
    act.mutate(
      { batchId: batch.id, action },
      {
        onSuccess: () => toast({ title: t('archivePage.batchMoved'), tone: 'success' }),
        onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
      },
    );

  return (
    <div className="rounded-sm border border-border/60 p-3">
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-mono text-[13px] font-medium text-text">{batch.number}</span>
        <StatusBadge
          tone={
            batch.status === 'executed'
              ? 'danger'
              : batch.status === 'approved'
                ? 'success'
                : batch.status === 'rejected'
                  ? 'neutral'
                  : 'warning'
          }
          label={t(`dispositionBatchStatus.${batch.status}`)}
        />
        <span className="text-xs text-text-muted">
          {t('archivePage.itemCount', { count: batch.items.length })}
        </span>
        <span className="ml-auto text-xs text-text-muted">
          {t('archivePage.batchBy', { name: batch.createdByName ?? '—' })}
        </span>
      </div>
      <p className="text-[13px] text-text">{batch.reason}</p>
      {batch.decisionComment ? (
        <p className="mt-0.5 text-xs text-text-muted">{batch.decisionComment}</p>
      ) : null}

      {batch.items.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1">
          {batch.items.map((i) => (
            <li key={i.documentId} className="flex items-center gap-2 text-xs">
              <Link
                to={`/app/docs/${i.documentId}`}
                className="font-mono text-primary hover:underline"
              >
                {i.regNumber ?? '—'}
              </Link>
              <span className="text-text">{i.subject}</span>
              {i.legalHold ? <span className="text-danger">{t('archivePage.held')}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {batch.status === 'draft' ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
              {t('archivePage.addItems')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={act.isPending}
              onClick={() => run('submit')}
            >
              {t('archivePage.submitBatch')}
            </Button>
          </>
        ) : null}
        {batch.canDecide ? (
          <>
            <Button size="sm" disabled={act.isPending} onClick={() => run('approve')}>
              {t('archivePage.approveBatch')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={act.isPending}
              onClick={() => run('reject')}
            >
              {t('archivePage.rejectBatch')}
            </Button>
          </>
        ) : null}
        {batch.status === 'approved' ? (
          <Button size="sm" variant="outline" onClick={() => setConfirmingExecute(true)}>
            {t('archivePage.executeBatch')}
          </Button>
        ) : null}
      </div>

      {adding ? (
        <AddItemsDialog
          pending={addItems.isPending}
          onClose={() => setAdding(false)}
          onSubmit={(ids) =>
            addItems.mutate(
              { batchId: batch.id, documentIds: ids },
              {
                onSuccess: () => {
                  toast({ title: t('archivePage.itemsAdded'), tone: 'success' });
                  setAdding(false);
                },
                onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
              },
            )
          }
        />
      ) : null}

      {confirmingExecute ? (
        <Dialog open onOpenChange={(o) => !o && setConfirmingExecute(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('archivePage.executeBatch')}</DialogTitle>
            </DialogHeader>
            {/* The plan asks for this in so many words: the operator must be told, before the
                last click, that what follows does not come back. */}
            <p role="alert" className="rounded-sm bg-danger/10 px-3 py-2 text-[13px] text-danger">
              {t('archivePage.executeWarning', { count: batch.items.length })}
            </p>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setConfirmingExecute(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                type="button"
                disabled={act.isPending}
                onClick={() => {
                  run('execute');
                  setConfirmingExecute(false);
                }}
              >
                {t('archivePage.executeConfirm')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function BatchForm({
  pending,
  onClose,
  onSubmit,
}: {
  pending: boolean;
  onClose: () => void;
  onSubmit: (number: string, reason: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const [number, setNumber] = useState('');
  const [reason, setReason] = useState('');
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (number.trim() && reason.trim()) onSubmit(number.trim(), reason.trim());
      }}
      className="flex flex-col gap-3"
    >
      <div className="flex flex-col gap-1">
        <Label htmlFor="batch-number">{t('archivePage.batchNumber')}</Label>
        <Input
          id="batch-number"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          required
          className="font-mono"
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor="batch-reason">{t('archive.reason')}</Label>
        <Input
          id="batch-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button type="submit" disabled={pending || !number.trim() || !reason.trim()}>
          {t('common.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}

function AddItemsDialog({
  pending,
  onClose,
  onSubmit,
}: {
  pending: boolean;
  onClose: () => void;
  onSubmit: (documentIds: string[]) => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  // Candidates only: nothing else may lawfully enter an act, and the server refuses the rest
  // anyway — offering them would be offering a dead end.
  const candidates = useArchive({ page: 1, limit: 200, candidatesOnly: true });
  const [selected, setSelected] = useState<string[]>([]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('archivePage.addItems')}</DialogTitle>
        </DialogHeader>
        {candidates.isPending ? (
          <Skeleton className="h-24 w-full rounded-md" />
        ) : (candidates.data?.items.length ?? 0) === 0 ? (
          <p className="text-[13px] text-text-muted">{t('archivePage.noCandidates.description')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {candidates.data!.items.map((e) => (
              <li key={e.documentId}>
                <label className="flex items-center gap-2 text-[13px] text-text">
                  <input
                    type="checkbox"
                    checked={selected.includes(e.documentId)}
                    onChange={(ev) =>
                      setSelected((s) =>
                        ev.target.checked
                          ? [...s, e.documentId]
                          : s.filter((id) => id !== e.documentId),
                      )
                    }
                  />
                  <span className="font-mono text-xs text-text-muted">{e.regNumber ?? '—'}</span>
                  {e.subject}
                </label>
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={pending || selected.length === 0}
            onClick={() => onSubmit(selected)}
          >
            {t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
