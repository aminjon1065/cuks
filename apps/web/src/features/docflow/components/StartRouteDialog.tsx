import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import {
  Skeleton,
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
 * step, ordered as added (docs/modules/11 §4). The approver search hits the server
 * (the directory list is capped), so any user is reachable. Route templates (task
 * 3.3 settings) are the alternative path, not required here.
 */
export function StartRouteDialog({
  documentId,
  open,
  onOpenChange,
}: StartRouteDialogProps): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const [search, setSearch] = useState('');
  const [approvers, setApprovers] = useState<Approver[]>([]);
  const directory = useDirectoryUsers(search);
  const start = useStartRoute(documentId);

  const add = (approver: Approver) => {
    if (approvers.some((a) => a.id === approver.id)) return;
    setApprovers((prev) => [...prev, approver]);
    setSearch('');
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
      <DialogContent closeLabel={t('common.close')}>
        <DialogHeader>
          <DialogTitle>{t('route.start.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="route-approver-search">{t('route.start.addApprover')}</Label>
            <Input
              id="route-approver-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('route.start.searchPlaceholder')}
            />
            {search.trim() ? (
              <div className="mt-1 max-h-40 overflow-y-auto rounded-sm border border-border">
                {directory.isLoading ? (
                  // A skeleton, not a spinner: this is a list, and the design system asks a
                  // loading list to keep the shape of what is arriving (06 §1).
                  <div className="flex flex-col gap-1 p-1.5" aria-busy="true">
                    {[0, 1, 2].map((i) => (
                      <Skeleton key={i} className="h-7 w-full" />
                    ))}
                  </div>
                ) : (directory.data ?? []).length === 0 ? (
                  <div className="py-3 text-center text-xs text-text-muted">—</div>
                ) : (
                  (directory.data ?? []).map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      disabled={approvers.some((a) => a.id === u.id)}
                      onClick={() => add({ id: u.id, name: u.shortName })}
                      className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] hover:bg-surface-2 disabled:opacity-40"
                    >
                      <span className="truncate">
                        {u.shortName}{' '}
                        <span className="font-mono text-xs text-text-muted">@{u.username}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
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
