import { useTranslation } from 'react-i18next';
import { Hash, Users } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Skeleton,
  toast,
} from '@cuks/ui';
import type { ChannelListItemDto } from '@cuks/shared';
import { useAddMember, useCatalog } from '../api/queries';

/** Browse and join public channels (docs/modules/13 §2/§7). */
export function CatalogDialog({
  meId,
  onClose,
  onJoined,
}: {
  meId: string;
  onClose: () => void;
  onJoined: (channelId: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  const catalog = useCatalog();

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('catalog.title')}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[26rem] min-h-32 overflow-y-auto">
          {catalog.isPending ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-14 rounded-md" />
              <Skeleton className="h-14 rounded-md" />
            </div>
          ) : catalog.isError ? (
            <EmptyState
              icon={Hash}
              title={t('catalog.loadError')}
              action={
                <Button variant="outline" size="sm" onClick={() => void catalog.refetch()}>
                  {t('list.retry')}
                </Button>
              }
            />
          ) : (catalog.data ?? []).length === 0 ? (
            <EmptyState icon={Hash} title={t('catalog.empty')} />
          ) : (
            <ul className="flex flex-col gap-2">
              {catalog.data!.map((c) => (
                <CatalogRow
                  key={c.id}
                  channel={c}
                  meId={meId}
                  onJoined={onJoined}
                  onClose={onClose}
                />
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CatalogRow({
  channel,
  meId,
  onJoined,
  onClose,
}: {
  channel: ChannelListItemDto;
  meId: string;
  onJoined: (channelId: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  const join = useAddMember(channel.id);

  const onJoin = (): void =>
    join.mutate(
      { userId: meId, role: 'member' },
      {
        onSuccess: () => {
          toast({ title: t('catalog.joined'), tone: 'success' });
          onJoined(channel.id);
          onClose();
        },
        onError: () => toast({ title: t('catalog.failed'), tone: 'danger' }),
      },
    );

  return (
    <li className="flex items-center gap-3 rounded-md border border-border p-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-surface-2 text-text-muted">
        <Hash className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium text-text">{channel.name}</div>
        {channel.topic ? (
          <div className="truncate text-xs text-text-muted">{channel.topic}</div>
        ) : (
          <div className="flex items-center gap-1 text-xs text-text-muted">
            <Users className="size-3" /> {channel.memberCount}
          </div>
        )}
      </div>
      <Button size="sm" variant="outline" onClick={onJoin} disabled={join.isPending}>
        {t('catalog.join')}
      </Button>
    </li>
  );
}
