import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, GitBranch, X } from 'lucide-react';
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
  DocumentDetailDto,
  RouteDto,
  RouteStatus,
  RouteStepDto,
  RouteStepStatus,
} from '@cuks/shared';
import { formatDateTime } from '@/lib/format';
import { useActRouteStep, useDocumentRoutes } from '../api/queries';
import { StartRouteDialog } from './StartRouteDialog';

const stepTone: Record<RouteStepStatus, NonNullable<BadgeProps['tone']>> = {
  pending: 'neutral',
  active: 'info',
  done: 'success',
  rejected: 'danger',
  skipped: 'neutral',
};
const routeTone: Record<RouteStatus, NonNullable<BadgeProps['tone']>> = {
  active: 'info',
  completed: 'success',
  cancelled: 'neutral',
};

export function RouteSection({ doc }: { doc: DocumentDetailDto }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const routesQuery = useDocumentRoutes(doc.id);
  const act = useActRouteStep(doc.id);
  const [startOpen, setStartOpen] = useState(false);
  const [rejecting, setRejecting] = useState<RouteStepDto | null>(null);
  const canSendToRoute = doc.canEdit && doc.status === 'draft';
  const routes = routesQuery.data ?? [];

  const approve = (step: RouteStepDto) => {
    act.mutate(
      { stepId: step.id, action: 'approve' },
      {
        onSuccess: () => toast({ title: t('route.approved'), tone: 'success' }),
        onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
      },
    );
  };

  return (
    <section className="rounded-md border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
          <GitBranch className="size-4" /> {t('route.title')}
        </h2>
        {canSendToRoute ? (
          <Button size="sm" onClick={() => setStartOpen(true)}>
            {t('route.send')}
          </Button>
        ) : null}
      </div>

      {routesQuery.isPending ? (
        <Skeleton className="h-24 w-full rounded-md" />
      ) : routesQuery.isError ? (
        <EmptyState title={t('common.loadError')} description={t('common.loadErrorHint')} />
      ) : routes.length === 0 ? (
        <p className="text-[13px] text-text-muted">{t('route.empty')}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {routes.map((route) => (
            <RouteBlock
              key={route.id}
              route={route}
              onApprove={approve}
              onReject={setRejecting}
              acting={act.isPending}
            />
          ))}
        </div>
      )}

      <StartRouteDialog documentId={doc.id} open={startOpen} onOpenChange={setStartOpen} />
      {rejecting ? (
        <RejectDialog
          onClose={() => setRejecting(null)}
          pending={act.isPending}
          onSubmit={(comment) =>
            act.mutate(
              { stepId: rejecting.id, action: 'reject', comment },
              {
                onSuccess: () => {
                  toast({ title: t('route.rejected'), tone: 'success' });
                  setRejecting(null);
                },
                onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
              },
            )
          }
        />
      ) : null}
    </section>
  );
}

function RouteBlock({
  route,
  onApprove,
  onReject,
  acting,
}: {
  route: RouteDto;
  onApprove: (step: RouteStepDto) => void;
  onReject: (step: RouteStepDto) => void;
  acting: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  return (
    <div className="rounded-sm border border-border/60">
      <div className="flex items-center justify-between border-b border-border/60 bg-surface-2 px-3 py-1.5">
        <span className="text-[13px] font-medium text-text">
          {t('route.cycle', { n: route.cycle })}
        </span>
        <StatusBadge tone={routeTone[route.status]} label={t(`routeStatus.${route.status}`)} />
      </div>
      <ol className="flex flex-col">
        {route.steps.map((step) => (
          <li
            key={step.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/40 px-3 py-2 last:border-b-0"
          >
            <span className="text-xs text-text-muted">{step.stepOrder}</span>
            <span className="min-w-32 flex-1 text-[13px] text-text">
              {step.assigneeName ?? '—'}
              <span className="ml-1.5 text-xs text-text-muted">
                {t(`routeStepKind.${step.kind}`)}
              </span>
            </span>
            <StatusBadge tone={stepTone[step.status]} label={t(`routeStepStatus.${step.status}`)} />
            {step.actedByName ? (
              <span className="text-xs text-text-muted">
                {step.actedByName}
                {step.actedForName ? ` ${t('route.onBehalfOf', { name: step.actedForName })}` : ''}
                {step.actedAt ? ` · ${formatDateTime(step.actedAt)}` : ''}
              </span>
            ) : null}
            {step.comment ? (
              <span className="w-full text-xs italic text-text-muted">«{step.comment}»</span>
            ) : null}
            {step.canAct ? (
              <span className="flex items-center gap-1.5">
                {step.actOnBehalfOfName ? (
                  <span className="text-xs font-medium text-warning">
                    {t('route.onBehalfOf', { name: step.actOnBehalfOfName })}
                  </span>
                ) : null}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={acting}
                  onClick={() => onApprove(step)}
                >
                  <Check className="size-4" /> {t('route.approve')}
                </Button>
                <Button size="sm" variant="ghost" disabled={acting} onClick={() => onReject(step)}>
                  <X className="size-4 text-danger" /> {t('route.reject')}
                </Button>
              </span>
            ) : null}
          </li>
        ))}
      </ol>
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
          <DialogTitle>{t('route.rejectTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="reject-reason">{t('route.rejectReason')}</Label>
            <Input
              id="reject-reason"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="danger" disabled={pending || !comment.trim()}>
              {t('route.reject')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
