import { useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { AlarmClock } from 'lucide-react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Button,
  DataTable,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  StatusBadge,
  cn,
  toast,
} from '@cuks/ui';
import type { ControlItemDto } from '@cuks/shared';
import { formatDate } from '@/lib/format';
import { useControlList, useControlResolutionAction } from '../api/queries';
import { controlSeverityTone } from '../lib/document';
import { useDocumentTitle } from '@/lib/use-document-title';

const inputClass = cn(
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

/** «На контроле» (docs/modules/11 §5, task 3.8): controlled resolutions + documents with a
 *  deadline, colour-coded by severity, with Продлить / Снять actions. */
export function ControlPage(): React.JSX.Element {
  const { t } = useTranslation('docflow');
  useDocumentTitle(t('control.title'));
  const navigate = useNavigate();
  const list = useControlList();
  const [extendItem, setExtendItem] = useState<ControlItemDto | null>(null);
  const [uncontrolItem, setUncontrolItem] = useState<ControlItemDto | null>(null);

  const columns = useMemo<ColumnDef<ControlItemDto, unknown>[]>(
    () => [
      {
        accessorKey: 'dueDate',
        header: t('control.columns.due'),
        cell: ({ row }) => (
          <StatusBadge
            tone={controlSeverityTone[row.original.severity]}
            label={row.original.dueDate ? formatDate(row.original.dueDate) : '—'}
          />
        ),
      },
      {
        accessorKey: 'subject',
        header: t('control.columns.subject'),
        cell: ({ row }) => (
          <span className="font-medium text-text">
            {row.original.regNumber ? (
              <span className="mr-1.5 font-mono text-xs text-text-muted">
                {row.original.regNumber}
              </span>
            ) : null}
            {row.original.resolutionText ?? row.original.subject}
          </span>
        ),
      },
      {
        accessorKey: 'executorName',
        header: t('control.columns.executor'),
        cell: ({ row }) => row.original.executorName ?? '—',
      },
      {
        accessorKey: 'kind',
        header: t('control.columns.kind'),
        cell: ({ row }) => t(`control.kind.${row.original.kind}`),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) =>
          row.original.kind === 'resolution' && row.original.canManage ? (
            <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="ghost" onClick={() => setExtendItem(row.original)}>
                {t('resolutions.extendAction')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setUncontrolItem(row.original)}>
                {t('control.uncontrol')}
              </Button>
            </div>
          ) : null,
      },
    ],
    [t],
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('control.title')} description={t('control.subtitle')} />

      <DataTable
        columns={columns}
        data={list.data ?? []}
        loading={list.isLoading}
        error={list.isError ? t('common.loadError') : undefined}
        onRetry={() => void list.refetch()}
        pageSize={100}
        onRowClick={(row) => navigate(`/app/docs/${row.documentId}`)}
        empty={
          <EmptyState
            icon={AlarmClock}
            title={t('control.empty.title')}
            description={t('control.empty.description')}
          />
        }
      />

      {extendItem ? <ExtendDialog item={extendItem} onClose={() => setExtendItem(null)} /> : null}
      {uncontrolItem ? (
        <UncontrolDialog item={uncontrolItem} onClose={() => setUncontrolItem(null)} />
      ) : null}
    </div>
  );
}

function ExtendDialog({
  item,
  onClose,
}: {
  item: ControlItemDto;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const action = useControlResolutionAction();
  const [due, setDue] = useState('');
  const [reason, setReason] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!due || !reason.trim()) return;
    action.mutate(
      {
        resolutionId: item.id,
        action: 'extend',
        body: { newDue: new Date(due).toISOString(), reason: reason.trim() },
      },
      {
        onSuccess: () => {
          toast({ title: t('resolutions.extendedToast'), tone: 'success' });
          onClose();
        },
        onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
      },
    );
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('resolutions.extendAction')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="control-due">{t('resolutions.form.due')}</Label>
            <input
              id="control-due"
              type="date"
              value={due}
              onChange={(e) => setDue(e.target.value)}
              required
              className={inputClass}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="control-reason">{t('resolutions.form.reason')}</Label>
            <Input
              id="control-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={action.isPending || !due || !reason.trim()}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UncontrolDialog({
  item,
  onClose,
}: {
  item: ControlItemDto;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const action = useControlResolutionAction();
  const [reason, setReason] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return;
    action.mutate(
      { resolutionId: item.id, action: 'uncontrol', body: { reason: reason.trim() } },
      {
        onSuccess: () => {
          toast({ title: t('control.uncontrolledToast'), tone: 'success' });
          onClose();
        },
        onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
      },
    );
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('control.uncontrol')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="uncontrol-reason">{t('resolutions.form.reason')}</Label>
            <Input
              id="uncontrol-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={action.isPending || !reason.trim()}>
              {t('control.uncontrol')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
