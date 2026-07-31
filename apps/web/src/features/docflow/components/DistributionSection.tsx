import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Clock, Send, Users } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Label,
  OrgUnitPicker,
  Skeleton,
  StatusBadge,
  cn,
  toast,
  type BadgeProps,
} from '@cuks/ui';
import type {
  AcquaintanceStatus,
  CreateDistributionInput,
  DistributionDto,
  DocumentDetailDto,
} from '@cuks/shared';
import { useOrgTree } from '@/features/admin/api/queries';
import { useMe } from '@/features/auth/api/queries';
import { formatDateTime } from '@/lib/format';
import {
  useAcknowledgeGate,
  useCreateDistribution,
  useDocumentDistributions,
} from '../api/queries';
import { UserMultiPicker, type PickedUser } from './UserPicker';

/** The picker wants a plain id/name tree; the admin DTO carries more than it needs. */
interface PickerNode {
  id: string;
  name: string;
  children: PickerNode[];
}
function orgTreeNodes(
  nodes: readonly { id: string; name: string; children?: unknown }[],
): PickerNode[] {
  return nodes.map((n) => ({
    id: n.id,
    name: n.name,
    children: orgTreeNodes((n.children ?? []) as readonly { id: string; name: string }[]),
  }));
}

const statusTone: Record<AcquaintanceStatus, NonNullable<BadgeProps['tone']>> = {
  pending: 'neutral',
  acknowledged: 'success',
  expired: 'danger',
  cancelled: 'neutral',
};

/**
 * «Ознакомление» — who was told to read this internal order, and who has (docs/modules/11
 * §12.4).
 *
 * The sheet is shown per distribution rather than as one flat list: an order sent to the
 * department in March and to the commission in May is two facts, and merging them would make
 * «все ознакомились» mean neither. `expired` is rendered as its own state — the batch opened
 * without that person, which is not a reading.
 */
export function DistributionSection({ doc }: { doc: DocumentDetailDto }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const query = useDocumentDistributions(doc.id);
  const canDistribute = doc.availableActions.includes('distribute');
  const [creating, setCreating] = useState(false);
  const batches = query.data ?? [];

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
          <Users className="size-4" /> {t('distribution.title')}
        </h2>
        {canDistribute ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Send className="size-4" /> {t('distribution.add')}
          </Button>
        ) : null}
      </div>

      {query.isPending ? (
        <Skeleton className="h-20 w-full rounded-md" />
      ) : query.isError ? (
        <EmptyState title={t('common.loadError')} description={t('common.loadErrorHint')} />
      ) : batches.length === 0 ? (
        <p className="text-[13px] text-text-muted">
          {doc.docClass !== 'internal'
            ? t('distribution.notApplicable')
            : doc.regNumber
              ? t('distribution.empty')
              : t('distribution.emptyUnregistered')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {batches.map((b) => (
            <li key={b.id}>
              <BatchCard documentId={doc.id} batch={b} />
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <DistributeDialog documentId={doc.id} onClose={() => setCreating(false)} />
      ) : null}
    </section>
  );
}

function BatchCard({
  documentId,
  batch,
}: {
  documentId: string;
  batch: DistributionDto;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const me = useMe().data;
  const acknowledge = useAcknowledgeGate(documentId);
  const done = batch.readers.filter((r) => r.status !== 'pending').length;
  const mine = batch.readers.find((r) => r.userId === me?.id);

  return (
    <div className="rounded-sm border border-border/60 p-3">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-[13px] font-medium text-text">
          {t('distribution.sentAt', { date: formatDateTime(batch.createdAt) })}
        </span>
        <span className="text-xs text-text-muted">
          {t('acquaintances.progress', { done, total: batch.readers.length })}
        </span>
        {batch.releasedAt ? (
          <StatusBadge
            tone={batch.releasedReason === 'timeout' ? 'warning' : 'success'}
            label={t(`proposals.gate.released.${batch.releasedReason ?? 'all_acknowledged'}`)}
          />
        ) : batch.releaseAt ? (
          <span className="text-xs text-warning">
            {t('distribution.dueAt', { date: formatDateTime(batch.releaseAt) })}
          </span>
        ) : null}
        <span className="ml-auto text-xs text-text-muted">
          {t('distribution.by', { name: batch.createdByName ?? '—' })}
        </span>
      </div>

      <ul className="flex flex-col gap-1">
        {batch.readers.map((r) => (
          <li key={r.userId} className="flex items-center gap-2 text-xs">
            {r.status === 'acknowledged' ? (
              <Check className="size-3.5 shrink-0 text-success" />
            ) : (
              <Clock className="size-3.5 shrink-0 text-text-muted" />
            )}
            <span className="text-text">{r.userName ?? '—'}</span>
            {r.position ? <span className="text-text-muted">· {r.position}</span> : null}
            <StatusBadge tone={statusTone[r.status]} label={t(`acquaintanceStatus.${r.status}`)} />
            <span className="ml-auto text-text-muted">
              {r.acknowledgedAt ? formatDateTime(r.acknowledgedAt) : ''}
            </span>
          </li>
        ))}
      </ul>

      {batch.canAcknowledge && mine?.status === 'pending' ? (
        <Button
          size="sm"
          className="mt-2"
          disabled={acknowledge.isPending}
          onClick={() =>
            acknowledge.mutate(batch.id, {
              onSuccess: () => toast({ title: t('acquaintances.doneToast'), tone: 'success' }),
              onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
            })
          }
        >
          {t('acquaintances.action')}
        </Button>
      ) : null}
    </div>
  );
}

function DistributeDialog({
  documentId,
  onClose,
}: {
  documentId: string;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const create = useCreateDistribution(documentId);
  const orgTree = useOrgTree();
  const [people, setPeople] = useState<PickedUser[]>([]);
  const [orgUnitId, setOrgUnitId] = useState<string | null>(null);
  const [includeSubtree, setIncludeSubtree] = useState(false);
  const [dueAt, setDueAt] = useState('');

  const targets: CreateDistributionInput['targets'] = [
    ...people.map((u) => ({ type: 'user' as const, id: u.id, includeSubtree: false })),
    ...(orgUnitId ? [{ type: 'org_unit' as const, id: orgUnitId, includeSubtree }] : []),
  ];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (targets.length === 0) return;
    create.mutate(
      { targets, dueAt: dueAt ? new Date(dueAt).toISOString() : null, note: null },
      {
        onSuccess: () => {
          toast({ title: t('distribution.createdToast'), tone: 'success' });
          onClose();
        },
        onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('distribution.add')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <UserMultiPicker
            label={t('distribution.form.people')}
            value={people}
            onChange={setPeople}
          />

          <div className="flex flex-col gap-1">
            <Label htmlFor="distribution-unit">{t('distribution.form.orgUnit')}</Label>
            <OrgUnitPicker
              tree={orgTreeNodes(orgTree.data ?? [])}
              value={orgUnitId}
              onChange={setOrgUnitId}
              placeholder={t('distribution.form.orgUnitPlaceholder')}
            />
            {orgUnitId ? (
              <label className="mt-1 flex items-center gap-2 text-[13px] text-text">
                <input
                  type="checkbox"
                  checked={includeSubtree}
                  onChange={(e) => setIncludeSubtree(e.target.checked)}
                />
                {t('distribution.form.includeSubtree')}
              </label>
            ) : null}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="distribution-due">{t('distribution.form.dueAt')}</Label>
            <input
              id="distribution-due"
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className={cn(
                'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
              )}
            />
            <p className="text-xs text-text-muted">{t('distribution.form.dueHint')}</p>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={create.isPending || targets.length === 0}>
              {t('distribution.submit')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
