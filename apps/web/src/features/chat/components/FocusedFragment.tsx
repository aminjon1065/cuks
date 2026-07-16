import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ChevronUp, MessagesSquare } from 'lucide-react';
import { Button, EmptyState, Skeleton, cn } from '@cuks/ui';
import type { ChannelDto, MessageDto } from '@cuks/shared';
import { useMessageContext } from '../api/queries';
import { buildFeedRows } from '../lib/grouping';
import { MessageItem } from './MessageItem';

/** Jump-to-message context view (docs/modules/13 §4): a bounded window around the target message with
 *  its own «load earlier» and a banner back to the live feed. The target row is briefly highlighted. */
export function FocusedFragment({
  channel,
  targetId,
  me,
  canModerate,
  pinnedIds,
  onReply,
  onExit,
}: {
  channel: ChannelDto;
  targetId: string;
  me: { id: string; name: string | null };
  canModerate: boolean;
  pinnedIds: ReadonlySet<string>;
  onReply: (m: MessageDto) => void;
  onExit: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  const ctx = useMessageContext(channel.id, targetId);
  const targetRef = useRef<HTMLDivElement>(null);

  const messages = useMemo(
    () =>
      (ctx.data?.pages ?? [])
        .flatMap((p) => p.items)
        .slice()
        .reverse(),
    [ctx.data],
  );
  const rows = useMemo(() => buildFeedRows(messages), [messages]);

  // Center the target exactly once — NOT on every «load earlier», which would yank the view back.
  const centered = useRef(false);
  useEffect(() => {
    if (!centered.current && messages.length > 0) {
      targetRef.current?.scrollIntoView({ block: 'center' });
      centered.current = true;
    }
  }, [messages.length]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface-2/50 px-4 py-1.5 text-xs text-text-muted">
        <span>{t('feed.fragment')}</span>
        <Button size="sm" variant="ghost" onClick={onExit}>
          <ArrowDown className="size-3.5" /> {t('feed.toLatest')}
        </Button>
      </div>

      {ctx.isPending ? (
        <div className="flex-1 space-y-4 p-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 rounded-md" />
          ))}
        </div>
      ) : ctx.isError || messages.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <EmptyState
            icon={MessagesSquare}
            title={t('feed.fragmentGone')}
            action={
              <Button size="sm" variant="outline" onClick={onExit}>
                {t('feed.toLatest')}
              </Button>
            }
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          {ctx.hasNextPage ? (
            <div className="flex justify-center py-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void ctx.fetchNextPage()}
                disabled={ctx.isFetchingNextPage}
              >
                <ChevronUp className="size-3.5" /> {t('feed.loadEarlier')}
              </Button>
            </div>
          ) : null}

          {rows.map((row) =>
            row.type === 'day' ? (
              <div key={row.key} className="flex items-center gap-3 px-4 py-2">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[11px] font-medium text-text-muted">{row.day}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
            ) : row.type === 'message' ? (
              <div
                key={row.key}
                ref={row.message.id === targetId ? targetRef : undefined}
                className={cn('transition-colors', row.message.id === targetId && 'bg-warning/10')}
              >
                <MessageItem
                  message={row.message}
                  showAuthor={row.showAuthor}
                  meId={me.id}
                  members={channel.members}
                  canModerate={canModerate}
                  pinned={pinnedIds.has(row.message.id)}
                  onReply={onReply}
                />
              </div>
            ) : null,
          )}
        </div>
      )}
    </div>
  );
}
