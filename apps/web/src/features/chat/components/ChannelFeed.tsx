import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { MessagesSquare, WifiOff } from 'lucide-react';
import { Button, EmptyState, Skeleton } from '@cuks/ui';
import { useChannel, useMarkRead, useMessages } from '../api/queries';
import { useChatRealtime } from '../hooks/useChatRealtime';
import { ChannelHeader } from './ChannelHeader';
import { MessageList } from './MessageList';
import { Composer } from './Composer';

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

  // Mark the channel read up to the newest real (non-optimistic) message.
  const lastRealId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const id = messages[i]!.id;
      if (!id.startsWith('temp-')) return id;
    }
    return null;
  }, [messages]);
  const markReadRef = useRef(markRead.mutate);
  markReadRef.current = markRead.mutate;
  useEffect(() => {
    if (lastRealId) markReadRef.current(lastRealId);
  }, [lastRealId, channelId]);

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
        />
      )}

      <Composer channelId={channelId} members={channel.data.members} me={me} />
    </div>
  );
}
