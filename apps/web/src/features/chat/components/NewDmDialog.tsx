import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Skeleton,
  cn,
  toast,
} from '@cuks/ui';
import { useCreateDm, useDirectoryUsers } from '../api/queries';

interface Picked {
  id: string;
  name: string;
}

/** Start (or reuse) a direct or group conversation (docs/modules/13 §2). */
export function NewDmDialog({
  meId,
  onClose,
  onCreated,
}: {
  meId: string;
  onClose: () => void;
  onCreated: (channelId: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Picked[]>([]);
  const directory = useDirectoryUsers(search);
  const create = useCreateDm();

  const pickedIds = new Set(picked.map((p) => p.id));
  const options = (directory.data ?? []).filter((u) => u.id !== meId && !pickedIds.has(u.id));

  const toggle = (u: { id: string; shortName: string }): void =>
    setPicked((prev) => [...prev, { id: u.id, name: u.shortName }]);
  const remove = (id: string): void => setPicked((prev) => prev.filter((p) => p.id !== id));

  const submit = (): void => {
    if (picked.length === 0) return;
    create.mutate(
      { userIds: picked.map((p) => p.id) },
      {
        onSuccess: (ch) => {
          onCreated(ch.id);
          onClose();
        },
        onError: () => toast({ title: t('dm.failed'), tone: 'danger' }),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('dm.title')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {picked.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {picked.map((p) => (
                <span
                  key={p.id}
                  className="flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2.5 pr-1 text-[13px] text-primary"
                >
                  {p.name}
                  <button
                    type="button"
                    onClick={() => remove(p.id)}
                    className="rounded-full p-0.5 hover:bg-primary/20"
                    aria-label={t('common.delete')}
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : null}

          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <Input
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('dm.search')}
              autoFocus
            />
          </div>

          <div className="max-h-64 min-h-24 overflow-y-auto rounded-md border border-border">
            {directory.isPending ? (
              <div className="flex flex-col gap-2 p-2">
                <Skeleton className="h-8 rounded" />
                <Skeleton className="h-8 rounded" />
              </div>
            ) : options.length === 0 ? (
              <p className="p-4 text-center text-[13px] text-text-muted">{t('list.searchEmpty')}</p>
            ) : (
              <ul>
                {options.map((u) => (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => toggle(u)}
                      className={cn(
                        'flex w-full flex-col items-start px-3 py-2 text-left hover:bg-surface-2',
                      )}
                    >
                      <span className="text-[13px] font-medium text-text">{u.shortName}</span>
                      <span className="text-xs text-text-muted">{u.fullName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
        <DialogFooter>
          <span className="mr-auto self-center text-xs text-text-muted">
            {t('dm.selected', { count: picked.length })}
          </span>
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="button" onClick={submit} disabled={create.isPending || picked.length === 0}>
            {t('dm.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
