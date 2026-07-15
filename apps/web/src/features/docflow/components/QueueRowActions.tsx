import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  toast,
} from '@cuks/ui';
import type { DocumentListItemDto, DocumentQueue } from '@cuks/shared';
import { documentsKey, useAcknowledge, useActRouteStep } from '../api/queries';

/**
 * Direct row actions in the cabinet queues (docs/modules/11 §7): Согласовать/Отклонить,
 * Ознакомлен directly from the list; Подписать opens the card (the signing modal needs
 * the full document + certificate step-up). Clicks stop propagation so the row's own
 * navigation does not fire.
 */
export function QueueRowActions({
  doc,
  queue,
}: {
  doc: DocumentListItemDto;
  queue: DocumentQueue;
}): React.JSX.Element | null {
  const { t } = useTranslation('docflow');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const act = useActRouteStep(doc.id);
  const acknowledge = useAcknowledge(doc.id);
  const [rejecting, setRejecting] = useState(false);

  const refreshQueues = () => {
    void qc.invalidateQueries({ queryKey: [...documentsKey, 'list'] });
    void qc.invalidateQueries({ queryKey: [...documentsKey, 'queue-counts'] });
  };
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  if (queue === 'to_sign') {
    return (
      <div onClick={stop}>
        <Button size="sm" variant="outline" onClick={() => navigate(`/app/docs/${doc.id}`)}>
          {t('signatures.sign.action')}
        </Button>
      </div>
    );
  }
  if (!doc.actionStepId) return null;
  const stepId = doc.actionStepId;

  if (queue === 'to_acknowledge') {
    return (
      <div onClick={stop}>
        <Button
          size="sm"
          disabled={acknowledge.isPending}
          onClick={() =>
            acknowledge.mutate(stepId, {
              onSuccess: () => {
                toast({ title: t('acquaintances.doneToast'), tone: 'success' });
                refreshQueues();
              },
              onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
            })
          }
        >
          {t('acquaintances.action')}
        </Button>
      </div>
    );
  }

  if (queue === 'to_approve') {
    return (
      <div className="flex gap-1.5" onClick={stop}>
        <Button
          size="sm"
          disabled={act.isPending}
          onClick={() =>
            act.mutate(
              { stepId, action: 'approve' },
              {
                onSuccess: () => {
                  toast({ title: t('route.approved'), tone: 'success' });
                  refreshQueues();
                },
                onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
              },
            )
          }
        >
          {t('route.approve')}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setRejecting(true)}>
          {t('route.reject')}
        </Button>
        {rejecting ? (
          <RejectDialog
            pending={act.isPending}
            onClose={() => setRejecting(false)}
            onSubmit={(comment) =>
              act.mutate(
                { stepId, action: 'reject', comment },
                {
                  onSuccess: () => {
                    toast({ title: t('route.rejected'), tone: 'success' });
                    setRejecting(false);
                    refreshQueues();
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

  return null;
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
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{t('route.rejectTitle')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="reject-comment">{t('route.rejectReason')}</Label>
            <Input
              id="reject-comment"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              required
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={pending || !comment.trim()}>
              {t('route.reject')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
