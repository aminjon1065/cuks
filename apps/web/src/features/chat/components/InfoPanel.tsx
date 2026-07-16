import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, LogOut, Pencil, Pin, Search, UserPlus, X } from 'lucide-react';
import { Avatar, AvatarFallback, Button, Input, Switch, cn, toast } from '@cuks/ui';
import type { ChannelDto, ChannelMemberRole, ChatNotifyLevel } from '@cuks/shared';
import {
  useAddMember,
  useDirectoryUsers,
  usePins,
  useRemoveMember,
  useUnpinMessage,
  useUpdateChannel,
  useUpdateMembership,
} from '../api/queries';
import { usePresence } from '../hooks/usePresence';
import { initials } from '../lib/grouping';
import { PresenceDot } from './PresenceDot';

const RANK: Record<ChannelMemberRole, number> = { member: 1, admin: 2, owner: 3 };
const inputClass =
  'h-9 rounded-sm border border-border bg-surface px-2.5 text-[13px] text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50';

/** Right column: channel description, the caller's notify/pin settings, and member management
 *  (docs/modules/13 §7). Role promotion/demotion is deferred (no backend endpoint in 5.2). */
export function InfoPanel({
  channel,
  meId,
  onLeft,
}: {
  channel: ChannelDto;
  meId: string;
  onLeft: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  const myRole = channel.myRole;
  const canManage = myRole === 'owner' || myRole === 'admin';
  const canManageMembers = canManage && channel.kind !== 'dm' && channel.kind !== 'org';

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto" aria-label={t('info.title')}>
      <TopicSection channel={channel} canEdit={canManage} />
      <MySettings channel={channel} />
      <PinsSection channelId={channel.id} canManage={canManage} />
      <MembersSection channel={channel} meId={meId} canManage={canManageMembers} onLeft={onLeft} />
    </div>
  );
}

function PinsSection({
  channelId,
  canManage,
}: {
  channelId: string;
  canManage: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  const pins = usePins(channelId);
  const unpin = useUnpinMessage(channelId);

  return (
    <Section title={t('info.pinned')}>
      {pins.isPending ? (
        <p className="text-[13px] text-text-muted">{t('info.pinsLoading')}</p>
      ) : (pins.data ?? []).length === 0 ? (
        <p className="text-[13px] text-text-muted">{t('info.noPins')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {pins.data!.map((p) => (
            <li key={p.messageId} className="group flex items-start gap-2 text-[13px]">
              <Pin className="mt-0.5 size-3.5 shrink-0 text-text-muted" />
              <div className="min-w-0 flex-1">
                <div className="text-xs text-text-muted">{p.authorName ?? '—'}</div>
                <div className="line-clamp-2 text-text">{p.bodyText ?? t('message.deleted')}</div>
              </div>
              {canManage ? (
                <button
                  type="button"
                  onClick={() =>
                    unpin.mutate(p.messageId, {
                      onError: () => toast({ title: t('info.failed'), tone: 'danger' }),
                    })
                  }
                  className="opacity-0 transition group-hover:opacity-100 hover:text-danger"
                  aria-label={t('message.unpin')}
                >
                  <X className="size-4 text-text-muted" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="border-b border-border p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function TopicSection({
  channel,
  canEdit,
}: {
  channel: ChannelDto;
  canEdit: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  const update = useUpdateChannel(channel.id);
  const [editing, setEditing] = useState(false);
  const [topic, setTopic] = useState(channel.topic ?? '');

  const save = (): void => {
    update.mutate(
      { topic: topic.trim() || null },
      {
        onSuccess: () => {
          toast({ title: t('info.saved'), tone: 'success' });
          setEditing(false);
        },
        onError: () => toast({ title: t('info.failed'), tone: 'danger' }),
      },
    );
  };

  return (
    <Section
      title={t('info.description')}
      action={
        canEdit && !editing ? (
          <button
            type="button"
            onClick={() => {
              setTopic(channel.topic ?? '');
              setEditing(true);
            }}
            className="text-text-muted hover:text-text"
            aria-label={t('info.description')}
          >
            <Pencil className="size-3.5" />
          </button>
        ) : null
      }
    >
      {editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder={t('info.topicPlaceholder')}
            className="w-full resize-y rounded-md border border-border bg-surface p-2 text-[13px] text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            autoFocus
          />
          <div className="flex justify-end gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={save} disabled={update.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      ) : (
        <p className={cn('text-[13px]', channel.topic ? 'text-text' : 'text-text-muted')}>
          {channel.topic || t('info.noDescription')}
        </p>
      )}
    </Section>
  );
}

function MySettings({ channel }: { channel: ChannelDto }): React.JSX.Element {
  const { t } = useTranslation('chat');
  const update = useUpdateMembership(channel.id);

  const setNotify = (level: ChatNotifyLevel): void => {
    update.mutate(
      { notifyLevel: level },
      { onError: () => toast({ title: t('info.failed'), tone: 'danger' }) },
    );
  };
  const setPin = (isPinned: boolean): void => {
    update.mutate(
      { isPinned },
      { onError: () => toast({ title: t('info.failed'), tone: 'danger' }) },
    );
  };

  return (
    <Section title={t('info.notify')}>
      <div className="flex flex-col gap-3">
        <select
          value={channel.myNotifyLevel}
          onChange={(e) => setNotify(e.target.value as ChatNotifyLevel)}
          className={inputClass}
          aria-label={t('info.notify')}
        >
          <option value="all">{t('info.notifyAll')}</option>
          <option value="mentions">{t('info.notifyMentions')}</option>
          <option value="mute">{t('info.notifyMute')}</option>
        </select>
        <label className="flex items-center justify-between text-[13px] text-text">
          {t('info.pin')}
          <Switch checked={channel.isPinned} onCheckedChange={setPin} />
        </label>
      </div>
    </Section>
  );
}

function MembersSection({
  channel,
  meId,
  canManage,
  onLeft,
}: {
  channel: ChannelDto;
  meId: string;
  canManage: boolean;
  onLeft: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  const remove = useRemoveMember(channel.id);
  const [adding, setAdding] = useState(false);
  const canLeave = channel.kind !== 'dm' && channel.kind !== 'org';
  const myRank = channel.myRole ? RANK[channel.myRole] : 0;
  const memberIds = useMemo(() => channel.members.map((m) => m.userId), [channel.members]);
  const presence = usePresence(memberIds);

  const roleLabel = (r: ChannelMemberRole): string =>
    r === 'owner'
      ? t('info.roleOwner')
      : r === 'admin'
        ? t('info.roleAdmin')
        : t('info.roleMember');

  const onRemove = (userId: string): void =>
    remove.mutate(userId, {
      onSuccess: () => toast({ title: t('info.removed'), tone: 'success' }),
      onError: () => toast({ title: t('info.failed'), tone: 'danger' }),
    });

  const onLeave = (): void =>
    remove.mutate(meId, {
      onSuccess: () => {
        toast({ title: t('info.left'), tone: 'success' });
        onLeft();
      },
      onError: () => toast({ title: t('info.failed'), tone: 'danger' }),
    });

  return (
    <Section
      title={t('info.members')}
      action={
        canManage ? (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="flex items-center gap-1 text-[12px] text-primary hover:opacity-80"
          >
            <UserPlus className="size-3.5" /> {t('info.addMember')}
          </button>
        ) : null
      }
    >
      {adding ? (
        <AddMember
          channelId={channel.id}
          existing={new Set(channel.members.map((m) => m.userId))}
          onDone={() => setAdding(false)}
        />
      ) : null}

      <ul className="flex flex-col gap-0.5">
        {channel.members.map((m) => {
          const removable = canManage && m.userId !== meId && RANK[m.role] < myRank;
          return (
            <li key={m.userId} className="group flex items-center gap-2.5 rounded-md px-1 py-1.5">
              <span className="relative shrink-0">
                <Avatar className="size-8">
                  <AvatarFallback className="text-[11px]">{initials(m.name)}</AvatarFallback>
                </Avatar>
                <PresenceDot status={presence.get(m.userId)} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] text-text">{m.name ?? m.userId}</div>
                <div className="text-xs text-text-muted">{roleLabel(m.role)}</div>
              </div>
              {removable ? (
                <button
                  type="button"
                  onClick={() => onRemove(m.userId)}
                  className="opacity-0 transition group-hover:opacity-100 hover:text-danger"
                  aria-label={t('info.removeMember')}
                >
                  <X className="size-4 text-text-muted" />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      {canLeave ? (
        <Button variant="ghost" size="sm" className="mt-2 text-danger" onClick={onLeave}>
          <LogOut className="size-4" /> {t('info.leave')}
        </Button>
      ) : null}
    </Section>
  );
}

function AddMember({
  channelId,
  existing,
  onDone,
}: {
  channelId: string;
  existing: Set<string>;
  onDone: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  const [search, setSearch] = useState('');
  const directory = useDirectoryUsers(search);
  const add = useAddMember(channelId);

  const options = (directory.data ?? []).filter((u) => !existing.has(u.id)).slice(0, 6);

  const onAdd = (userId: string): void =>
    add.mutate(
      { userId, role: 'member' },
      {
        onSuccess: () => {
          toast({ title: t('info.added'), tone: 'success' });
          onDone();
        },
        onError: () => toast({ title: t('info.failed'), tone: 'danger' }),
      },
    );

  return (
    <div className="mb-3 rounded-md border border-border p-2">
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
        <Input
          className="h-8 pl-8"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('dm.search')}
          autoFocus
        />
      </div>
      <ul className="flex flex-col">
        {options.map((u) => (
          <li key={u.id}>
            <button
              type="button"
              onClick={() => onAdd(u.id)}
              disabled={add.isPending}
              className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-surface-2"
            >
              <span className="truncate">{u.shortName}</span>
              <Check className="size-3.5 text-text-muted" />
            </button>
          </li>
        ))}
        {directory.data && options.length === 0 ? (
          <li className="px-2 py-1.5 text-xs text-text-muted">{t('list.searchEmpty')}</li>
        ) : null}
      </ul>
    </div>
  );
}
