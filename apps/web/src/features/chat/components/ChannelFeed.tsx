import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MessagesSquare, WifiOff } from 'lucide-react';
import { Button, EmptyState, Skeleton } from '@cuks/ui';
import type { WsEventPayloads } from '@cuks/shared';
import { useSocketEvent } from '@/lib/socket';
import { useChannel, useMarkRead, useMessages } from '../api/queries';
import { useChatRealtime } from '../hooks/useChatRealtime';
import { ChannelHeader } from './ChannelHeader';
import { MessageList } from './MessageList';
import { Composer } from './Composer';

/** How long a typing hint stays visible without a follow-up event (sender re-emits every 3s). */
const TYPING_TTL_MS = 5_000;

/** Center column: a channel's header, its live cursor-paged message feed and the composer. */
export function ChannelFeed({
  channelId,
  me,
  infoOpen,
  onToggleInfo,
  onBack,
}: {
  channelId: string;
  me: { id: string; name: string | null };
  infoOpen: boolean;
  onToggleInfo: () => void;
  onBack: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  const channel = useChannel(channelId);
  const messagesQ = useMessages(channelId);
  useChatRealtime(channelId);
  const markRead = useMarkRead(channelId);

  // Pages come newest-first (each page descending); flatten and reverse to chronological order.
  const messages = useMemo(() => {
    const all = (messagesQ.data?.pages ?? []).flatMap((p) => p.items);
    return all.slice().reverse();
  }, [messagesQ.data]);

  // The «Новые» divider anchors to the read position at the moment the channel was OPENED (this
  // component remounts per channel), so it stays put while mark-read advances underneath.
  const anchorRef = useRef<{ set: boolean; id: string | null }>({ set: false, id: null });
  if (channel.data && !anchorRef.current.set) {
    anchorRef.current = { set: true, id: channel.data.myLastReadMessageId };
  }

  // Mark read up to the newest real message — but only while the user can actually see it: the tab
  // is visible and the feed is at the bottom (docs/modules/13 §4 «по видимости»).
  const lastRealId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const id = messages[i]!.id;
      if (!id.startsWith('temp-')) return id;
    }
    return null;
  }, [messages]);
  const [atBottom, setAtBottom] = useState(true);
  const markReadRef = useRef(markRead.mutate);
  markReadRef.current = markRead.mutate;
  useEffect(() => {
    if (!lastRealId || !atBottom) return;
    const fire = (): void => {
      if (document.visibilityState === 'visible') markReadRef.current(lastRealId);
    };
    fire();
    document.addEventListener('visibilitychange', fire);
    return () => document.removeEventListener('visibilitychange', fire);
  }, [lastRealId, channelId, atBottom]);

  // Typing hints (docs/modules/13 §4): userId → expiry; senders re-emit every 3s, entries expire
  // after 5s or as soon as that user's message lands.
  const [typing, setTyping] = useState<ReadonlyMap<string, number>>(new Map());
  const onTyping = useCallback(
    (payload: WsEventPayloads['chat.typing']) => {
      if (payload.channelId !== channelId || payload.userId === me.id) return;
      setTyping((prev) => new Map(prev).set(payload.userId, Date.now() + TYPING_TTL_MS));
    },
    [channelId, me.id],
  );
  useSocketEvent('chat.typing', onTyping);
  const onTypingMessage = useCallback(
    (payload: WsEventPayloads['chat.message.created']) => {
      if (payload.channelId !== channelId) return;
      setTyping((prev) => {
        if (!prev.has(payload.actorId)) return prev;
        const next = new Map(prev);
        next.delete(payload.actorId);
        return next;
      });
    },
    [channelId],
  );
  useSocketEvent('chat.message.created', onTypingMessage);
  const hasTyping = typing.size > 0;
  useEffect(() => {
    if (!hasTyping) return;
    const timer = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        const alive = [...prev].filter(([, expiry]) => expiry > now);
        return alive.length === prev.size ? prev : new Map(alive);
      });
    }, 1_000);
    return () => clearInterval(timer);
  }, [hasTyping]);

  const typingNames = useMemo(() => {
    const members = channel.data?.members ?? [];
    return [...typing.keys()]
      .map((id) => members.find((m) => m.userId === id)?.name)
      .filter((n): n is string => !!n);
  }, [typing, channel.data?.members]);

  if (channel.isError) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <EmptyState
          icon={MessagesSquare}
          title={t('feed.notFound')}
          description={t('feed.notFoundHint')}
        />
      </div>
    );
  }

  if (channel.isPending || !channel.data) {
    return (
      <div className="flex h-full flex-col">
        <div className="border-b border-border px-4 py-3">
          <Skeleton className="h-6 w-40" />
        </div>
        <div className="flex-1 space-y-4 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChannelHeader
        channel={channel.data}
        infoOpen={infoOpen}
        onToggleInfo={onToggleInfo}
        onBack={onBack}
      />

      {messagesQ.isPending ? (
        <div className="flex-1 space-y-4 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-md" />
          ))}
        </div>
      ) : messagesQ.isError ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            icon={WifiOff}
            title={t('feed.loadError')}
            action={
              <Button size="sm" variant="outline" onClick={() => void messagesQ.refetch()}>
                {t('list.retry')}
              </Button>
            }
          />
        </div>
      ) : messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            icon={MessagesSquare}
            title={t('feed.empty')}
            description={t('feed.emptyHint')}
          />
        </div>
      ) : (
        <MessageList
          messages={messages}
          hasMore={messagesQ.hasNextPage}
          isFetchingOlder={messagesQ.isFetchingNextPage}
          onFetchOlder={() => void messagesQ.fetchNextPage()}
          lastReadId={anchorRef.current.set ? anchorRef.current.id : undefined}
          meId={me.id}
          onAtBottomChange={setAtBottom}
        />
      )}

      {/* Reserved height so the hint never shifts the feed/composer (docs/06 §1.4). */}
      <div className="h-5 px-4 text-xs text-text-muted" aria-live="polite">
        {typingNames.length === 1
          ? t('feed.typingOne', { name: typingNames[0] })
          : typingNames.length > 1
            ? t('feed.typingMany')
            : null}
      </div>

      <Composer channelId={channelId} members={channel.data.members} me={me} />
    </div>
  );
}
