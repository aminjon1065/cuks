import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  cn,
  toast,
} from '@cuks/ui';
import type { CreateResolutionInput } from '@cuks/shared';
import { useCreateResolution, useCreateSubResolution, useDirectoryUsers } from '../api/queries';

const inputClass = cn(
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

export interface AddResolutionDialogProps {
  documentId: string;
  /** When set, this is a sub-resolution delegated under the given parent. */
  parentId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddResolutionDialog({
  documentId,
  parentId,
  open,
  onOpenChange,
}: AddResolutionDialogProps): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const [search, setSearch] = useState('');
  const [executor, setExecutor] = useState<{ id: string; name: string } | null>(null);
  const [text, setText] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [isControl, setIsControl] = useState(false);
  const directory = useDirectoryUsers(search);
  const create = useCreateResolution(documentId);
  const createSub = useCreateSubResolution(documentId);
  const pending = create.isPending || createSub.isPending;

  const reset = () => {
    setSearch('');
    setExecutor(null);
    setText('');
    setDueDate('');
    setIsControl(false);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!executor || !text.trim()) return;
    const input: CreateResolutionInput = {
      text: text.trim(),
      executorId: executor.id,
      isControl,
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
    };
    const onSuccess = () => {
      toast({ title: t('resolutions.add.done'), tone: 'success' });
      reset();
      onOpenChange(false);
    };
    const onError = () => toast({ title: t('common.actionFailed'), tone: 'danger' });
    if (parentId) createSub.mutate({ parentId, input }, { onSuccess, onError });
    else create.mutate(input, { onSuccess, onError });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {parentId ? t('resolutions.sub.title') : t('resolutions.add.title')}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="resolution-executor">{t('resolutions.form.executor')}</Label>
            {executor ? (
              <div className="flex items-center justify-between rounded-sm border border-border px-3 py-1.5 text-[13px]">
                <span>{executor.name}</span>
                <button
                  type="button"
                  className="text-text-muted hover:text-danger"
                  onClick={() => setExecutor(null)}
                >
                  {t('common.edit')}
                </button>
              </div>
            ) : (
              <>
                <Input
                  id="resolution-executor"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t('resolutions.form.searchPlaceholder')}
                />
                {search.trim() ? (
                  <div className="mt-1 max-h-36 overflow-y-auto rounded-sm border border-border">
                    {(directory.data ?? []).length === 0 ? (
                      <div className="py-2 text-center text-xs text-text-muted">—</div>
                    ) : (
                      (directory.data ?? []).map((u) => (
                        <button
                          key={u.id}
                          type="button"
                          onClick={() => setExecutor({ id: u.id, name: u.shortName })}
                          className="flex w-full items-center px-3 py-2 text-left text-[13px] hover:bg-surface-2"
                        >
                          {u.shortName}
                          <span className="ml-1.5 font-mono text-xs text-text-muted">
                            @{u.username}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="resolution-text">{t('resolutions.form.text')}</Label>
            <textarea
              id="resolution-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={3}
              required
              className={cn(inputClass, 'h-auto py-2')}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="resolution-due">{t('resolutions.form.due')}</Label>
            <input
              id="resolution-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className={inputClass}
            />
          </div>

          <label className="flex items-center gap-2 text-[13px] text-text">
            <input
              type="checkbox"
              checked={isControl}
              onChange={(e) => setIsControl(e.target.checked)}
            />
            {t('resolutions.form.control')}
          </label>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={pending || !executor || !text.trim()}>
              {t('resolutions.add.action')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
