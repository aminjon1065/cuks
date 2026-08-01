import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, Lock, LockOpen, Undo2 } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  StatusBadge,
  cn,
  toast,
} from '@cuks/ui';
import type { DocumentDetailDto } from '@cuks/shared';
import { formatDateTime } from '@/lib/format';
import {
  useArchiveDocument,
  useClearLegalHold,
  useRestoreDocument,
  useSetLegalHold,
} from '../api/queries';

const controlClass = cn(
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

/**
 * «Архив» on the card: where the document is filed, until when, and what holds it
 * (docs/modules/11 §12.12).
 *
 * The retention date is shown as the FROZEN fact it is, next to the term it was derived from,
 * so «почему именно эта дата» has an answer on the screen. A legal hold is rendered loudly
 * and with its reason — a hold nobody can see is a hold somebody will try to work around.
 */
export function ArchiveSection({ doc }: { doc: DocumentDetailDto }): React.JSX.Element | null {
  const { t } = useTranslation('docflow');
  const [archiving, setArchiving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [holding, setHolding] = useState<'set' | 'clear' | null>(null);
  const a = doc.archive;

  const canArchive = doc.availableActions.includes('archive');
  const canRestore = doc.availableActions.includes('restore');
  const canHold = doc.availableActions.includes('legalHold');
  // Nothing to say and nothing to do: an ordinary working document.
  if (!a.archivedAt && !a.legalHold && !canArchive && !canHold) return null;

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
          <Archive className="size-4" /> {t('archive.title')}
        </h2>
        <div className="flex flex-wrap gap-1.5">
          {canArchive ? (
            <Button size="sm" variant="outline" onClick={() => setArchiving(true)}>
              <Archive className="size-3.5" /> {t('archive.action')}
            </Button>
          ) : null}
          {canRestore ? (
            <Button size="sm" variant="outline" onClick={() => setRestoring(true)}>
              <Undo2 className="size-3.5" /> {t('archive.restoreAction')}
            </Button>
          ) : null}
          {canHold ? (
            <Button
              size="sm"
              variant={a.legalHold ? 'outline' : 'ghost'}
              onClick={() => setHolding(a.legalHold ? 'clear' : 'set')}
            >
              {a.legalHold ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />}
              {t(a.legalHold ? 'archive.clearHoldAction' : 'archive.holdAction')}
            </Button>
          ) : null}
        </div>
      </div>

      {a.legalHold ? (
        <p
          role="alert"
          className="mb-2 flex flex-wrap items-center gap-2 rounded-sm bg-danger/10 px-3 py-2 text-[13px] text-danger"
        >
          <Lock className="size-4 shrink-0" aria-hidden />
          <span className="font-medium">{t('archive.heldTitle')}</span>
          <span>{a.legalHoldReason}</span>
        </p>
      ) : null}

      {a.archivedAt ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
          <dt className="text-text-muted">{t('archive.archivedAt')}</dt>
          <dd className="text-text">
            {formatDateTime(a.archivedAt)}
            {a.archivedByName ? ` · ${a.archivedByName}` : ''}
          </dd>
          <dt className="text-text-muted">{t('archive.retention')}</dt>
          <dd className="text-text">
            {a.isPermanent ? (
              <StatusBadge tone="info" label={t('archive.permanent')} />
            ) : a.retentionUntil ? (
              // The term it was derived from travels with the date, so it can be explained.
              t('archive.retentionUntil', {
                date: formatDateTime(a.retentionUntil),
                months: a.retentionMonths ?? '—',
              })
            ) : (
              t('archive.noRetention')
            )}
          </dd>
          <dt className="text-text-muted">{t('archive.disposition')}</dt>
          <dd>
            <StatusBadge
              tone={
                a.dispositionStatus === 'executed'
                  ? 'danger'
                  : a.dispositionStatus === 'candidate'
                    ? 'warning'
                    : 'neutral'
              }
              label={t(`dispositionStatus.${a.dispositionStatus}`)}
            />
            {a.disposedAt ? (
              <span className="ml-2 text-text-muted">{formatDateTime(a.disposedAt)}</span>
            ) : null}
          </dd>
        </dl>
      ) : (
        <p className="text-[13px] text-text-muted">{t('archive.notArchived')}</p>
      )}

      {archiving ? <ArchiveDialog doc={doc} onClose={() => setArchiving(false)} /> : null}
      {restoring ? <RestoreDialog doc={doc} onClose={() => setRestoring(false)} /> : null}
      {holding ? <HoldDialog doc={doc} mode={holding} onClose={() => setHolding(null)} /> : null}
    </section>
  );
}

function ArchiveDialog({
  doc,
  onClose,
}: {
  doc: DocumentDetailDto;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const archive = useArchiveDocument(doc.id);
  const [caseIndex, setCaseIndex] = useState(doc.caseIndex ?? '');
  const [note, setNote] = useState('');

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('archive.action')}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            archive.mutate(
              { caseIndex: caseIndex.trim() || null, note: note.trim() || null },
              {
                onSuccess: () => {
                  toast({ title: t('archive.archivedToast'), tone: 'success' });
                  onClose();
                },
                onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
              },
            );
          }}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="archive-case">{t('documents.card.caseIndex')}</Label>
            <Input
              id="archive-case"
              value={caseIndex}
              onChange={(e) => setCaseIndex(e.target.value)}
              className="font-mono"
            />
            {/* The term is read from the case, so which case it is decides the deadline. */}
            <p className="text-xs text-text-muted">{t('archive.caseHint')}</p>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="archive-note">{t('archive.note')}</Label>
            <Input id="archive-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={archive.isPending}>
              {t('archive.action')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RestoreDialog({
  doc,
  onClose,
}: {
  doc: DocumentDetailDto;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const restore = useRestoreDocument(doc.id);
  const [reason, setReason] = useState('');

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('archive.restoreAction')}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!reason.trim()) return;
            restore.mutate(
              { reason: reason.trim() },
              {
                onSuccess: () => {
                  toast({ title: t('archive.restoredToast'), tone: 'success' });
                  onClose();
                },
                onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
              },
            );
          }}
          className="flex flex-col gap-3"
        >
          <p className="rounded-sm bg-warning/10 px-3 py-2 text-[13px] text-warning">
            {t('archive.restoreWarning')}
          </p>
          <div className="flex flex-col gap-1">
            <Label htmlFor="archive-reason">{t('archive.reason')}</Label>
            <Input
              id="archive-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={restore.isPending || !reason.trim()}>
              {t('archive.restoreAction')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function HoldDialog({
  doc,
  mode,
  onClose,
}: {
  doc: DocumentDetailDto;
  mode: 'set' | 'clear';
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const setHold = useSetLegalHold(doc.id);
  const clearHold = useClearLegalHold(doc.id);
  const [reason, setReason] = useState('');
  const pending = setHold.isPending || clearHold.isPending;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>
            {t(mode === 'set' ? 'archive.holdAction' : 'archive.clearHoldAction')}
          </DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (!reason.trim()) return;
            const mutation = mode === 'set' ? setHold : clearHold;
            mutation.mutate(
              { reason: reason.trim() },
              {
                onSuccess: () => {
                  toast({
                    title: t(mode === 'set' ? 'archive.heldToast' : 'archive.unheldToast'),
                    tone: 'success',
                  });
                  onClose();
                },
                onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
              },
            );
          }}
          className="flex flex-col gap-3"
        >
          <p className="text-[13px] text-text-muted">
            {t(mode === 'set' ? 'archive.holdHint' : 'archive.clearHoldHint')}
          </p>
          <div className="flex flex-col gap-1">
            <Label htmlFor="hold-reason">{t('archive.reason')}</Label>
            <textarea
              id="hold-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              rows={2}
              className={cn(controlClass, 'h-auto py-2')}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={pending || !reason.trim()}>
              {t(mode === 'set' ? 'archive.holdAction' : 'archive.clearHoldAction')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
