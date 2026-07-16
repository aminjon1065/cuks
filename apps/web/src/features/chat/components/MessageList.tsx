import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ChatMemberDto, MessageDto } from '@cuks/shared';
import { formatDate } from '@/lib/format';
import { buildFeedRows } from '../lib/grouping';
import { MessageItem } from './MessageItem';

/** Virtualized message feed (docs/modules/13 §7): day separators + author-grouped rows, newest at the
 *  bottom. Sticks to the bottom for incoming messages, loads older pages when scrolled near the top and
 *  compensates scroll position so the view doesn't jump when older messages prepend. */
export function MessageList({
  messages,
  hasMore,
  isFetchingOlder,
  onFetchOlder,
  lastReadId,
  meId,
  members,
  canModerate,
  pinnedIds,
  onReply,
  onAtBottomChange,
}: {
  messages: MessageDto[];
  hasMore: boolean;
  isFetchingOlder: boolean;
  onFetchOlder: () => void;
  /** Read anchor captured at channel open — places the «Новые» divider (docs/modules/13 §4). */
  lastReadId: string | null | undefined;
  meId: string;
  members: ChatMemberDto[];
  canModerate: boolean;
  pinnedIds: ReadonlySet<string>;
  onReply: (m: MessageDto) => void;
  onAtBottomChange: (atBottom: boolean) => void;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(
    () => buildFeedRows(messages, { lastReadId, meId }),
    [messages, lastReadId, meId],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 60,
    overscan: 10,
    getItemKey: (index) => rows[index]!.key,
  });

  // Keep the viewport stable across data changes: preserve position when older messages prepend,
  // otherwise follow the bottom for new messages.
  const stick = useRef(true);
  const prevLen = useRef(0);
  const olderAnchor = useRef<number | null>(null);

  // A fresh mount opens pinned to the bottom — re-sync the parent, whose atBottom state survives
  // remounts (error→retry, empty→first message) and would otherwise stay stale, muting mark-read.
  const onAtBottomChangeRef = useRef(onAtBottomChange);
  onAtBottomChangeRef.current = onAtBottomChange;
  useEffect(() => {
    onAtBottomChangeRef.current(true);
  }, []);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (olderAnchor.current !== null && rows.length > prevLen.current) {
      el.scrollTop += el.scrollHeight - olderAnchor.current;
      olderAnchor.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevLen.current = rows.length;
  }, [rows.length]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom !== stick.current) onAtBottomChange(atBottom);
    stick.current = atBottom;
    if (el.scrollTop < 120 && hasMore && !isFetchingOlder) {
      olderAnchor.current = el.scrollHeight;
      onFetchOlder();
    }
  };

  const todayStr = formatDate(new Date().toISOString());
  const yesterdayStr = formatDate(new Date(Date.now() - 86_400_000).toISOString());
  const dayLabel = (day: string): string =>
    day === todayStr ? t('feed.today') : day === yesterdayStr ? t('feed.yesterday') : day;

  const items = virtualizer.getVirtualItems();

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className="min-h-0 flex-1 overflow-y-auto"
      aria-label={t('aria.messageFeed')}
    >
      {isFetchingOlder ? (
        <div className="py-2 text-center text-xs text-text-muted">{t('feed.loadingOlder')}</div>
      ) : null}
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {items.map((vi) => {
          const row = rows[vi.index]!;
          return (
            <div
              key={vi.key}
              data-index={vi.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`,
              }}
            >
              {row.type === 'day' ? (
                <div className="flex items-center gap-3 px-4 py-2">
                  <span className="h-px flex-1 bg-border" />
                  <span className="text-[11px] font-medium text-text-muted">
                    {dayLabel(row.day)}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
              ) : row.type === 'new' ? (
                <div className="flex items-center gap-3 px-4 py-1.5" role="separator">
                  <span className="h-px flex-1 bg-danger/50" />
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-danger">
                    {t('feed.new')}
                  </span>
                  <span className="h-px flex-1 bg-danger/50" />
                </div>
              ) : (
                <MessageItem
                  message={row.message}
                  showAuthor={row.showAuthor}
                  meId={meId}
                  members={members}
                  canModerate={canModerate}
                  pinned={pinnedIds.has(row.message.id)}
                  onReply={onReply}
                />
              )}
            </div>
          );
        })}
      </div>
      <div className="h-2" />
    </div>
  );
}
