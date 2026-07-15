import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ClipboardList, CornerDownRight, Plus } from 'lucide-react';
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
  Skeleton,
  StatusBadge,
  cn,
  toast,
  type BadgeProps,
} from '@cuks/ui';
import type { DocumentDetailDto, ResolutionDto, ResolutionStatus } from '@cuks/shared';
import { useCan } from '@/lib/ability';
import { formatDateTime } from '@/lib/format';
import { useDocumentResolutions, useResolutionAction } from '../api/queries';
import { AddResolutionDialog } from './AddResolutionDialog';

const statusTone: Record<ResolutionStatus, NonNullable<BadgeProps['tone']>> = {
  active: 'info',
  done: 'success',
  cancelled: 'neutral',
};

export function ResolutionSection({ doc }: { doc: DocumentDetailDto }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const query = useDocumentResolutions(doc.id);
  const canResolve =
    useCan('docflow.resolve') && (doc.status === 'registered' || doc.status === 'in_progress');
  const [addOpen, setAddOpen] = useState(false);
  const roots = query.data ?? [];

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
          <ClipboardList className="size-4" /> {t('resolutions.title')}
        </h2>
        {canResolve ? (
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" /> {t('resolutions.add.action')}
          </Button>
        ) : null}
      </div>

      {query.isPending ? (
        <Skeleton className="h-20 w-full rounded-md" />
      ) : query.isError ? (
        <EmptyState title={t('common.loadError')} description={t('common.loadErrorHint')} />
      ) : roots.length === 0 ? (
        <p className="text-[13px] text-text-muted">{t('resolutions.empty')}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {roots.map((r) => (
            <ResolutionNode key={r.id} documentId={doc.id} resolution={r} depth={0} />
          ))}
        </div>
      )}

      <AddResolutionDialog documentId={doc.id} open={addOpen} onOpenChange={setAddOpen} />
    </section>
  );
}

function ResolutionNode({
  documentId,
  resolution: r,
  depth,
}: {
  documentId: string;
  resolution: ResolutionDto;
  depth: number;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const act = useResolutionAction(documentId);
  const [subOpen, setSubOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [extending, setExtending] = useState(false);

  const done = () =>
    act.mutate(
      { resolutionId: r.id, action: 'done' },
      {
        onSuccess: () => toast({ title: t('resolutions.doneToast'), tone: 'success' }),
        onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
      },
    );
  const cancel = () =>
    act.mutate(
      { resolutionId: r.id, action: 'cancel' },
      { onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }) },
    );

  return (
    <div style={{ marginLeft: depth * 16 }} className="flex flex-col gap-2">
      <div className="rounded-sm border border-border/60 p-3">
        <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
          {depth > 0 ? <CornerDownRight className="size-3.5 text-text-muted" /> : null}
          <span className="text-[13px] font-medium text-text">{r.executorName ?? '—'}</span>
          <StatusBadge tone={statusTone[r.status]} label={t(`resolutionStatus.${r.status}`)} />
          {r.isControl ? (
            <span className="rounded bg-warning/10 px-1.5 text-[10px] font-semibold uppercase text-warning">
              {t('resolutions.control')}
            </span>
          ) : null}
          {r.dueDate ? (
            <span className="text-xs text-text-muted">
              {t('resolutions.due')}: {formatDateTime(r.dueDate)}
            </span>
          ) : null}
        </div>
        <p className="text-[13px] text-text">{r.text}</p>
        <p className="mt-0.5 text-xs text-text-muted">
          {t('resolutions.from', { name: r.authorName ?? '—' })}
        </p>
        {r.report ? (
          <p className="mt-1 rounded-sm bg-surface-2 px-2 py-1 text-xs text-text">
            {t('resolutions.report')}: {r.report}
          </p>
        ) : null}
        {r.extensions.map((e) => (
          <p key={e.id} className="mt-0.5 text-xs text-text-muted">
            {t('resolutions.extended', {
              date: formatDateTime(e.newDue),
              reason: e.reason,
              by: e.extendedByName ?? '—',
            })}
          </p>
        ))}

        <div className="mt-2 flex flex-wrap gap-1.5">
          {r.canReport ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={act.isPending}
                onClick={() => setReporting(true)}
              >
                {t('resolutions.reportAction')}
              </Button>
              <Button size="sm" variant="outline" disabled={act.isPending} onClick={done}>
                {t('resolutions.doneAction')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSubOpen(true)}>
                {t('resolutions.delegate')}
              </Button>
            </>
          ) : null}
          {r.canManage ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={act.isPending}
                onClick={() => setExtending(true)}
              >
                {t('resolutions.extendAction')}
              </Button>
              <Button size="sm" variant="ghost" disabled={act.isPending} onClick={cancel}>
                {t('resolutions.cancelAction')}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {r.children.map((child) => (
        <ResolutionNode
          key={child.id}
          documentId={documentId}
          resolution={child}
          depth={depth + 1}
        />
      ))}

      <AddResolutionDialog
        documentId={documentId}
        parentId={r.id}
        open={subOpen}
        onOpenChange={setSubOpen}
      />
      {reporting ? (
        <ReportDialog
          pending={act.isPending}
          onClose={() => setReporting(false)}
          onSubmit={(report) =>
            act.mutate(
              { resolutionId: r.id, action: 'report', body: { report } },
              {
                onSuccess: () => {
                  toast({ title: t('resolutions.reportedToast'), tone: 'success' });
                  setReporting(false);
                },
                onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
              },
            )
          }
        />
      ) : null}
      {extending ? (
        <ExtendDialog
          pending={act.isPending}
          onClose={() => setExtending(false)}
          onSubmit={(newDue, reason) =>
            act.mutate(
              { resolutionId: r.id, action: 'extend', body: { newDue, reason } },
              {
                onSuccess: () => {
                  toast({ title: t('resolutions.extendedToast'), tone: 'success' });
                  setExtending(false);
                },
                onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
              },
            )
          }
        />
      ) : null}
    </div>
  );
}

function ReportDialog({
  onClose,
  onSubmit,
  pending,
}: {
  onClose: () => void;
  onSubmit: (report: string) => void;
  pending: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const [report, setReport] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (report.trim()) onSubmit(report.trim());
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('resolutions.reportAction')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="resolution-report">{t('resolutions.report')}</Label>
            <Input
              id="resolution-report"
              value={report}
              onChange={(e) => setReport(e.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={pending || !report.trim()}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ExtendDialog({
  onClose,
  onSubmit,
  pending,
}: {
  onClose: () => void;
  onSubmit: (newDue: string, reason: string) => void;
  pending: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const [due, setDue] = useState('');
  const [reason, setReason] = useState('');
  const inputClass = cn(
    'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (due && reason.trim()) onSubmit(new Date(due).toISOString(), reason.trim());
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('resolutions.extendAction')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="extend-due">{t('resolutions.form.due')}</Label>
            <input
              id="extend-due"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              required
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="extend-reason">{t('resolutions.form.reason')}</Label>
            <Input
              id="extend-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={pending || !due || !reason.trim()}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
