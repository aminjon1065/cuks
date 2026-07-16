import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Hash, Lock, MessageSquarePlus, Plus, Search, Users } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Skeleton,
  cn,
} from '@cuks/ui';
import type { ChannelListItemDto, PresenceStatus } from '@cuks/shared';
import { formatRelativeTime } from '@/lib/format';
import { useMyChannels } from '../api/queries';
import { usePresence } from '../hooks/usePresence';
import { channelDisplayName, initials, sectionChannels } from '../lib/grouping';
import { CreateChannelDialog } from './CreateChannelDialog';
import { NewDmDialog } from './NewDmDialog';
import { CatalogDialog } from './CatalogDialog';
import { PresenceDot } from './PresenceDot';

type DialogKind = 'channel' | 'dm' | 'catalog';

/** Left column: searchable, sectioned list of conversations with a "+" to start new ones. */
export function ConversationList({
  meId,
  activeChannelId,
  onSelect,
  onOpenSearch,
}: {
  meId: string;
  activeChannelId: string | undefined;
  onSelect: (channelId: string) => void;
  onOpenSearch: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  const channels = useMyChannels();
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<DialogKind | null>(null);

  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = (channels.data ?? []).filter(
      (c) => !q || channelDisplayName(c, t('kind.dm')).toLowerCase().includes(q),
    );
    return sectionChannels(items);
  }, [channels.data, search, t]);

  // Presence dots for DM rows — the single counterpart of each direct conversation.
  const dmUserIds = useMemo(
    () =>
      (channels.data ?? [])
        .filter((c) => c.kind === 'dm')
        .map((c) => c.otherMembers[0]?.userId)
        .filter((id): id is string => !!id),
    [channels.data],
  );
  const presence = usePresence(dmUserIds);

  const total = sections.pinned.length + sections.channels.length + sections.personal.length;

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label={t('aria.conversationList')}>
      <div className="flex items-center gap-2 border-b border-border p-3">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <Input
            className="h-9 pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('list.search')}
          />
        </div>
        <Button size="icon" variant="ghost" onClick={onOpenSearch} aria-label={t('search.title')}>
          <Search className="size-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="outline" aria-label={t('list.new')}>
              <Plus className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setDialog('channel')}>
              <Hash className="size-4" /> {t('list.newChannel')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog('dm')}>
              <MessageSquarePlus className="size-4" /> {t('list.newDm')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setDialog('catalog')}>
              <Users className="size-4" /> {t('list.browseCatalog')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {channels.isPending ? (
          <div className="flex flex-col gap-1.5 p-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-12 rounded-md" />
            ))}
          </div>
        ) : channels.isError ? (
          <EmptyState
            title={t('list.loadError')}
            action={
              <Button size="sm" variant="outline" onClick={() => void channels.refetch()}>
                {t('list.retry')}
              </Button>
            }
          />
        ) : total === 0 ? (
          <EmptyState
            icon={MessageSquarePlus}
            title={t('list.empty')}
            description={t('list.emptyHint')}
          />
        ) : (
          <div className="flex flex-col gap-3">
            <Section
              title={t('sections.pinned')}
              items={sections.pinned}
              activeId={activeChannelId}
              onSelect={onSelect}
              meFallback={t('kind.dm')}
              presence={presence}
            />
            <Section
              title={t('sections.channels')}
              items={sections.channels}
              activeId={activeChannelId}
              onSelect={onSelect}
              meFallback={t('kind.dm')}
              presence={presence}
            />
            <Section
              title={t('sections.personal')}
              items={sections.personal}
              activeId={activeChannelId}
              onSelect={onSelect}
              meFallback={t('kind.dm')}
              presence={presence}
            />
          </div>
        )}
      </div>

      {dialog === 'channel' ? (
        <CreateChannelDialog onClose={() => setDialog(null)} onCreated={onSelect} />
      ) : null}
      {dialog === 'dm' ? (
        <NewDmDialog meId={meId} onClose={() => setDialog(null)} onCreated={onSelect} />
      ) : null}
      {dialog === 'catalog' ? (
        <CatalogDialog meId={meId} onClose={() => setDialog(null)} onJoined={onSelect} />
      ) : null}
    </div>
  );
}

function Section({
  title,
  items,
  activeId,
  onSelect,
  meFallback,
  presence,
}: {
  title: string;
  items: ChannelListItemDto[];
  activeId: string | undefined;
  onSelect: (id: string) => void;
  meFallback: string;
  presence: Map<string, PresenceStatus>;
}): React.JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
        {title}
      </div>
      <ul className="flex flex-col gap-0.5">
        {items.map((c) => (
          <ConversationRow
            key={c.id}
            channel={c}
            active={c.id === activeId}
            onSelect={onSelect}
            fallback={meFallback}
            presence={c.kind === 'dm' ? presence.get(c.otherMembers[0]?.userId ?? '') : undefined}
          />
        ))}
      </ul>
    </div>
  );
}

function ConversationRow({
  channel,
  active,
  onSelect,
  fallback,
  presence,
}: {
  channel: ChannelListItemDto;
  active: boolean;
  onSelect: (id: string) => void;
  fallback: string;
  presence: PresenceStatus | undefined;
}): React.JSX.Element {
  const name = channelDisplayName(channel, fallback);
  const isDm = channel.kind === 'dm' || channel.kind === 'group';
  const Icon = channel.kind === 'private' ? Lock : Hash;

  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(channel.id)}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
          active ? 'bg-primary/10 text-primary' : 'text-text hover:bg-surface-2',
        )}
      >
        <span className="relative shrink-0">
          <span
            className={cn(
              'flex size-8 items-center justify-center rounded-md text-xs font-medium',
              active ? 'bg-primary/15 text-primary' : 'bg-surface-2 text-text-muted',
            )}
          >
            {isDm ? initials(name) : <Icon className="size-4" />}
          </span>
          <PresenceDot status={presence} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="truncate text-[13px] font-medium">{name}</span>
            {channel.lastMessageAt ? (
              <span className="shrink-0 text-[11px] text-text-muted">
                {formatRelativeTime(channel.lastMessageAt)}
              </span>
            ) : null}
          </span>
        </span>
        {channel.unreadMentions > 0 ? (
          <span className="min-w-5 shrink-0 rounded-full bg-danger px-1.5 text-center text-[11px] font-semibold leading-5 text-white">
            @{channel.unreadMentions > 99 ? '99+' : channel.unreadMentions}
          </span>
        ) : null}
        {channel.unreadCount > 0 ? (
          <span className="min-w-5 shrink-0 rounded-full bg-primary px-1.5 text-center text-[11px] font-semibold leading-5 text-primary-fg">
            {channel.unreadCount > 99 ? '99+' : channel.unreadCount}
          </span>
        ) : null}
      </button>
    </li>
  );
}
