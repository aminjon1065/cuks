import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Clock, FileSignature, Hourglass, Pencil, Plus, X } from 'lucide-react';
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
  toast,
  type BadgeProps,
} from '@cuks/ui';
import type {
  AcquaintanceGateDto,
  AcquaintanceStatus,
  DocumentDetailDto,
  ResolutionProposalDto,
  ResolutionProposalStatus,
} from '@cuks/shared';
import { useMe } from '@/features/auth/api/queries';
import { useCan } from '@/lib/ability';
import { formatDateTime } from '@/lib/format';
import { useAcknowledgeGate, useDocumentProposals, useProposalAction } from '../api/queries';
import { ProposalDialog } from './ProposalDialog';

const statusTone: Record<ResolutionProposalStatus, NonNullable<BadgeProps['tone']>> = {
  draft: 'neutral',
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
  cancelled: 'neutral',
};

const lineTone: Record<AcquaintanceStatus, NonNullable<BadgeProps['tone']>> = {
  pending: 'neutral',
  acknowledged: 'success',
  expired: 'danger',
  cancelled: 'neutral',
};

/** Whole seconds left until `iso`, re-rendered each second while any remain. */
function useSecondsLeft(iso: string | null): number | null {
  const [left, setLeft] = useState<number | null>(() =>
    iso ? Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000)) : null,
  );
  useEffect(() => {
    if (!iso) {
      setLeft(null);
      return;
    }
    const tick = () =>
      setLeft(Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [iso]);
  return left;
}

function formatCountdown(seconds: number): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`;
}

/**
 * Draft resolutions and the pre-execution reading gate (docs/modules/11 §12.11).
 *
 * The section shows the same proposal three ways, because three people look at it: the
 * drafter (edit, hand to the signer), the signer (approve or return with a reason), and a
 * reader held at the gate (confirm reading, and see how long the executors are still
 * waiting). What the caller may actually do comes from the server on each proposal —
 * `canDecide` — never from a role guess on the client.
 */
export function ProposalsSection({ doc }: { doc: DocumentDetailDto }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const query = useDocumentProposals(doc.id);
  const canDraft = useCan('docflow.use') && !!doc.regNumber;
  const [editing, setEditing] = useState<ResolutionProposalDto | 'new' | null>(null);
  const proposals = query.data ?? [];

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
          <FileSignature className="size-4" /> {t('proposals.title')}
        </h2>
        {canDraft ? (
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            <Plus className="size-4" /> {t('proposals.add')}
          </Button>
        ) : null}
      </div>

      {query.isPending ? (
        <Skeleton className="h-20 w-full rounded-md" />
      ) : query.isError ? (
        <EmptyState title={t('common.loadError')} description={t('common.loadErrorHint')} />
      ) : proposals.length === 0 ? (
        <p className="text-[13px] text-text-muted">
          {doc.regNumber ? t('proposals.empty') : t('proposals.emptyUnregistered')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {proposals.map((p) => (
            <li key={p.id}>
              <ProposalCard documentId={doc.id} proposal={p} onEdit={() => setEditing(p)} />
            </li>
          ))}
        </ul>
      )}

      {editing ? (
        <ProposalDialog
          documentId={doc.id}
          value={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}

function ProposalCard({
  documentId,
  proposal: p,
  onEdit,
}: {
  documentId: string;
  proposal: ResolutionProposalDto;
  onEdit: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const act = useProposalAction(documentId);
  const [rejecting, setRejecting] = useState(false);

  const run = (action: 'submit' | 'approve', successKey: string) =>
    act.mutate(
      { proposalId: p.id, action },
      {
        onSuccess: () => toast({ title: t(successKey), tone: 'success' }),
        onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
      },
    );

  return (
    <div className="rounded-sm border border-border/60 p-3">
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusBadge tone={statusTone[p.status]} label={t(`proposalStatus.${p.status}`)} />
        <span className="text-[13px] font-medium text-text">
          {t('proposals.signer', { name: p.signerName ?? '—' })}
        </span>
        {p.isControl ? (
          <span className="rounded bg-warning/10 px-1.5 text-[10px] font-semibold uppercase text-warning">
            {t('resolutions.control')}
          </span>
        ) : null}
        {p.dueAt ? (
          <span className="text-xs text-text-muted">
            {t('resolutions.due')}: {formatDateTime(p.dueAt)}
          </span>
        ) : null}
      </div>

      <p className="text-[13px] text-text">{p.text}</p>
      <p className="mt-0.5 text-xs text-text-muted">
        {t('proposals.by', { name: p.proposedByName ?? '—' })}
        {p.responsibleExecutorName
          ? ` · ${t('proposals.executor', { name: p.responsibleExecutorName })}`
          : ''}
      </p>

      {p.decidedAt ? (
        <p className="mt-1 text-xs text-text-muted">
          {t('proposals.decidedBy', {
            name: p.decidedByName ?? '—',
            date: formatDateTime(p.decidedAt),
          })}
          {p.decidedForName ? ` · ${t('proposals.actedFor', { name: p.decidedForName })}` : ''}
        </p>
      ) : null}
      {p.status === 'rejected' && p.decisionComment ? (
        <p className="mt-1 rounded-sm bg-danger/10 px-2 py-1 text-xs text-text">
          {t('proposals.returnComment')}: {p.decisionComment}
        </p>
      ) : null}

      {p.gate ? <GateBlock documentId={documentId} gate={p.gate} /> : null}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {p.canEdit ? (
          <>
            <Button size="sm" variant="ghost" onClick={onEdit}>
              <Pencil className="size-3.5" /> {t('common.edit')}
            </Button>
            {p.status === 'draft' ? (
              <Button
                size="sm"
                variant="outline"
                disabled={act.isPending}
                onClick={() => run('submit', 'proposals.submittedToast')}
              >
                {t('proposals.submitAction')}
              </Button>
            ) : null}
          </>
        ) : null}
        {p.canDecide && p.status === 'pending' ? (
          <>
            <Button
              size="sm"
              disabled={act.isPending}
              onClick={() => run('approve', 'proposals.approvedToast')}
            >
              <Check className="size-3.5" /> {t('proposals.approveAction')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={act.isPending}
              onClick={() => setRejecting(true)}
            >
              <X className="size-3.5" /> {t('proposals.rejectAction')}
            </Button>
          </>
        ) : null}
      </div>

      {rejecting ? (
        <RejectDialog
          pending={act.isPending}
          onClose={() => setRejecting(false)}
          onSubmit={(comment) =>
            act.mutate(
              { proposalId: p.id, action: 'reject', body: { comment } },
              {
                onSuccess: () => {
                  toast({ title: t('proposals.rejectedToast'), tone: 'success' });
                  setRejecting(false);
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

/** The reading gate: who still owes a reading, how long the executors wait, and why it opened. */
function GateBlock({
  documentId,
  gate,
}: {
  documentId: string;
  gate: AcquaintanceGateDto;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const me = useMe().data;
  const acknowledge = useAcknowledgeGate(documentId);
  const secondsLeft = useSecondsLeft(gate.releasedAt ? null : gate.releaseAt);
  const myLine = gate.lines.find((l) => l.userId === me?.id);
  const doneCount = gate.lines.filter((l) => l.status !== 'pending').length;

  return (
    <div className="mt-2 rounded-sm border border-border/60 bg-surface-2 p-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <Hourglass className="size-3.5 text-text-muted" />
        <span className="text-xs font-medium text-text">{t('proposals.gate.title')}</span>
        <span className="text-xs text-text-muted">
          {t('acquaintances.progress', { done: doneCount, total: gate.lines.length })}
        </span>
        {gate.releasedAt ? (
          <StatusBadge
            tone={gate.releasedReason === 'timeout' ? 'warning' : 'success'}
            label={t(`proposals.gate.released.${gate.releasedReason ?? 'all_acknowledged'}`)}
          />
        ) : secondsLeft !== null ? (
          <span className="font-mono text-xs text-warning" aria-live="off">
            {t('proposals.gate.countdown', { time: formatCountdown(secondsLeft) })}
          </span>
        ) : null}
      </div>

      <ul className="flex flex-col gap-1">
        {gate.lines.map((l) => (
          <li key={l.userId} className="flex items-center gap-2 text-xs">
            {l.status === 'acknowledged' ? (
              <Check className="size-3.5 shrink-0 text-success" />
            ) : (
              <Clock className="size-3.5 shrink-0 text-text-muted" />
            )}
            <span className="text-text">{l.userName ?? '—'}</span>
            <StatusBadge tone={lineTone[l.status]} label={t(`acquaintanceStatus.${l.status}`)} />
            <span className="ml-auto text-text-muted">
              {l.acknowledgedAt ? formatDateTime(l.acknowledgedAt) : ''}
            </span>
          </li>
        ))}
      </ul>

      {myLine?.status === 'pending' && !gate.releasedAt ? (
        <Button
          size="sm"
          className="mt-2"
          disabled={acknowledge.isPending}
          onClick={() =>
            acknowledge.mutate(gate.id, {
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

function RejectDialog({
  onClose,
  onSubmit,
  pending,
}: {
  onClose: () => void;
  onSubmit: (comment: string) => void;
  pending: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const [comment, setComment] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (comment.trim()) onSubmit(comment.trim());
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('proposals.rejectAction')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="proposal-reject-comment">{t('proposals.returnComment')}</Label>
            <Input
              id="proposal-reject-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder={t('proposals.returnCommentHint')}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={pending || !comment.trim()}>
              {t('proposals.rejectAction')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
