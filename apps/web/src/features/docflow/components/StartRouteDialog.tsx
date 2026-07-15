import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  UserPicker,
  toast,
} from '@cuks/ui';
import type { StartRouteInput } from '@cuks/shared';
import { useDirectoryUsers, useStartRoute } from '../api/queries';

interface Approver {
  id: string;
  name: string;
}

export interface StartRouteDialogProps {
  documentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Build an ad-hoc sequential approval route: each added approver is one `approve`
 * step, ordered as added (docs/modules/11 §4). Route templates (task 3.3 settings)
 * are the alternative path, not required here.
 */
export function StartRouteDialog({
  documentId,
  open,
  onOpenChange,
}: StartRouteDialogProps): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const [picked, setPicked] = useState<string | null>(null);
  const [approvers, setApprovers] = useState<Approver[]>([]);
  const directory = useDirectoryUsers('');
  const start = useStartRoute(documentId);

  const options = useMemo(
    () =>
      (directory.data ?? []).map((u) => ({ id: u.id, label: u.shortName, sublabel: u.username })),
    [directory.data],
  );

  const add = () => {
    const user = directory.data?.find((u) => u.id === picked);
    if (!user || approvers.some((a) => a.id === user.id)) return;
    setApprovers((prev) => [...prev, { id: user.id, name: user.shortName }]);
    setPicked(null);
  };

  const submit = () => {
    const input: StartRouteInput = {
      steps: approvers.map((a, i) => ({
        order: i + 1,
        kind: 'approve',
        assigneeType: 'user',
        assigneeId: a.id,
      })),
    };
    start.mutate(input, {
      onSuccess: () => {
        toast({ title: t('route.start.done'), tone: 'success' });
        setApprovers([]);
        onOpenChange(false);
      },
      onError: () => toast({ title: t('common.actionFailed'), tone: 'danger' }),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('route.start.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label>{t('route.start.addApprover')}</Label>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <UserPicker
                  options={options}
                  value={picked}
                  onChange={setPicked}
                  placeholder={t('route.start.pickApprover')}
                  searchPlaceholder={t('route.start.searchPlaceholder')}
                />
              </div>
              <Button type="button" variant="outline" size="sm" disabled={!picked} onClick={add}>
                <Plus className="size-4" /> {t('route.start.add')}
              </Button>
            </div>
          </div>

          {approvers.length === 0 ? (
            <p className="text-[13px] text-text-muted">{t('route.start.empty')}</p>
          ) : (
            <ol className="flex flex-col gap-1.5">
              {approvers.map((a, i) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between rounded-sm border border-border px-3 py-1.5 text-[13px]"
                >
                  <span>
                    <span className="mr-2 text-text-muted">{i + 1}.</span>
                    {a.name}
                  </span>
                  <button
                    type="button"
                    aria-label={t('route.start.remove')}
                    className="text-text-muted hover:text-danger"
                    onClick={() => setApprovers((prev) => prev.filter((x) => x.id !== a.id))}
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ol>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              disabled={approvers.length === 0 || start.isPending}
              onClick={submit}
            >
              {t('route.start.action')}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
