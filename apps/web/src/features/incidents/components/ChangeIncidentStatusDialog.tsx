import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  availableIncidentStatusTargets,
  incidentStatusTransition,
  type ChangeIncidentStatusInput,
  type IncidentStatus,
} from '@cuks/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  toast,
} from '@cuks/ui';
import { ApiError } from '@/lib/api-client';
import { useChangeIncidentStatus } from '../api/queries';

const STATUS_ERROR_KEYS: Record<string, string> = {
  'incidents.status.stale': 'statusChange.errors.stale',
  'incidents.status.unchanged': 'statusChange.errors.unchanged',
  'incidents.status.invalid_transition': 'statusChange.errors.invalidTransition',
  'incidents.status.rollback_reason_required': 'statusChange.errors.reasonRequired',
};

export function ChangeIncidentStatusDialog({
  incidentId,
  currentStatus,
  open,
  onOpenChange,
}: {
  incidentId: string;
  currentStatus: IncidentStatus;
  open: boolean;
  onOpenChange: (value: boolean) => void;
}): React.JSX.Element {
  const { t } = useTranslation('incidents');
  const changeStatus = useChangeIncidentStatus();
  const targets = useMemo(() => availableIncidentStatusTargets(currentStatus), [currentStatus]);
  const [target, setTarget] = useState<IncidentStatus>(targets.at(-1) ?? currentStatus);
  const [reason, setReason] = useState('');
  const rollback = incidentStatusTransition(currentStatus, target) === 'rollback';

  useEffect(() => {
    if (!open) return;
    setTarget(targets.at(-1) ?? currentStatus);
    setReason('');
  }, [currentStatus, open, targets]);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    const input: ChangeIncidentStatusInput = {
      expectedStatus: currentStatus,
      status: target,
      ...(rollback ? { reason: reason.trim() } : {}),
    };
    changeStatus.mutate(
      { id: incidentId, input },
      {
        onSuccess: () => {
          toast({ title: t('statusChange.success'), tone: 'success' });
          onOpenChange(false);
        },
        onError: (error) => {
          const key = error instanceof ApiError ? STATUS_ERROR_KEYS[error.code] : undefined;
          toast({ title: key ? t(key) : t('statusChange.errors.generic'), tone: 'danger' });
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('actions.close')}>
        <DialogHeader>
          <DialogTitle>{t('statusChange.title')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="incident-status-target" required>
              {t('statusChange.target')}
            </Label>
            <select
              id="incident-status-target"
              value={target}
              onChange={(event) => setTarget(event.target.value as IncidentStatus)}
              className="h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              {targets.map((item) => (
                <option key={item} value={item}>
                  {t(`status.${item}`)}
                </option>
              ))}
            </select>
          </div>
          {rollback ? (
            <div className="space-y-1.5">
              <Label htmlFor="incident-status-reason" required>
                {t('statusChange.reason')}
              </Label>
              <textarea
                id="incident-status-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                rows={4}
                maxLength={1_000}
                required
                aria-describedby="incident-status-reason-hint"
                className="w-full resize-y rounded-sm border border-border bg-surface px-3 py-2 text-[13px] text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              />
              <p id="incident-status-reason-hint" className="text-xs text-text-muted">
                {t('statusChange.reasonHint')}
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('actions.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={changeStatus.isPending || (rollback && !reason.trim())}
              data-testid="incident-status-submit"
            >
              {rollback ? t('statusChange.rollback') : t('statusChange.advance')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
