import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Hash, Loader2, Search, X } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  cn,
} from '@cuks/ui';
import type { ChatSearchPeriod, ChatSearchResultDto } from '@cuks/shared';
import { CHAT_SEARCH_PERIODS } from '@cuks/shared';
import { formatDateTime } from '@/lib/format';
import { useChatSearch, useDirectoryUsers, useMyChannels } from '../api/queries';
import { channelDisplayName } from '../lib/grouping';

interface PickedUser {
  id: string;
  name: string;
}

/** Global message search with channel / author / period filters and jump-to-message (docs/modules/13
 *  §4). Opened from the conversation list; a hit navigates to the channel focused on the message. */
export function SearchDialog({
  meId,
  presetChannelId,
  onClose,
  onJump,
}: {
  meId: string;
  presetChannelId?: string | undefined;
  onClose: () => void;
  onJump: (channelId: string, messageId: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  const [raw, setRaw] = useState('');
  const [q, setQ] = useState('');
  const [period, setPeriod] = useState<ChatSearchPeriod>('all');
  const [channelId, setChannelId] = useState<string>(presetChannelId ?? '');
  const [fromUser, setFromUser] = useState<PickedUser | null>(null);

  // Debounce the query so we don't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQ(raw), 300);
    return () => clearTimeout(timer);
  }, [raw]);

  const channels = useMyChannels();
  const search = useChatSearch({
    q,
    channelId: channelId || undefined,
    fromUserId: fromUser?.id,
    period,
  });
  const results = useMemo(() => (search.data?.pages ?? []).flatMap((p) => p.items), [search.data]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('search.title')}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
            <Input
              className="pl-8"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder={t('search.placeholder')}
              autoFocus
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-md border border-border p-0.5">
              {CHAT_SEARCH_PERIODS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={cn(
                    'rounded-sm px-2 py-1 text-xs transition-colors',
                    period === p ? 'bg-primary/10 text-primary' : 'text-text-muted hover:text-text',
                  )}
                >
                  {t(`search.period.${p}`)}
                </button>
              ))}
            </div>
            <select
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              className="h-8 rounded-sm border border-border bg-surface px-2 text-[13px] text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              aria-label={t('search.channelFilter')}
            >
              <option value="">{t('search.allChannels')}</option>
              {(channels.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {channelDisplayName(c, t('kind.dm'))}
                </option>
              ))}
            </select>
            <FromUserFilter value={fromUser} onChange={setFromUser} meId={meId} />
          </div>

          <div className="max-h-[26rem] min-h-40 overflow-y-auto">
            {q.trim().length === 0 ? (
              <EmptyState icon={Search} title={t('search.prompt')} />
            ) : search.isPending ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-text-muted">
                <Loader2 className="size-4 animate-spin" /> {t('search.searching')}
              </div>
            ) : search.isError ? (
              <EmptyState
                icon={Search}
                title={t('search.loadError')}
                action={
                  <Button variant="outline" size="sm" onClick={() => void search.refetch()}>
                    {t('list.retry')}
                  </Button>
                }
              />
            ) : results.length === 0 ? (
              <EmptyState icon={Search} title={t('search.empty')} />
            ) : (
              <ul className="flex flex-col gap-1">
                {results.map((r) => (
                  <ResultRow
                    key={r.messageId}
                    result={r}
                    query={q}
                    onJump={() => {
                      onJump(r.channelId, r.messageId);
                      onClose();
                    }}
                  />
                ))}
                {search.hasNextPage ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 self-center"
                    onClick={() => void search.fetchNextPage()}
                    disabled={search.isFetchingNextPage}
                  >
                    {t('search.more')}
                  </Button>
                ) : null}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ResultRow({
  result,
  query,
  onJump,
}: {
  result: ChatSearchResultDto;
  query: string;
  onJump: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  const channelLabel =
    result.channelName ||
    result.otherMembers
      .map((m) => m.name)
      .filter(Boolean)
      .join(', ') ||
    t(`kind.${result.channelKind}`);
  return (
    <li>
      <button
        type="button"
        onClick={onJump}
        className="flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-surface-2"
      >
        <div className="flex items-center gap-1.5 text-xs text-text-muted">
          <Hash className="size-3" />
          <span className="font-medium text-text">{channelLabel}</span>
          <span>·</span>
          <span>{result.authorName ?? '—'}</span>
          <span className="ml-auto">{formatDateTime(result.createdAt)}</span>
        </div>
        <div className="line-clamp-2 text-[13px] text-text">
          {highlight(result.bodyText ?? '', query)}
        </div>
      </button>
    </li>
  );
}

function FromUserFilter({
  value,
  onChange,
  meId,
}: {
  value: PickedUser | null;
  onChange: (user: PickedUser | null) => void;
  meId: string;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  const [term, setTerm] = useState('');
  const directory = useDirectoryUsers(term);

  // Remember the chosen user's name so the chip doesn't depend on the current directory result set.
  if (value) {
    return (
      <span className="flex items-center gap-1 rounded-full bg-primary/10 py-0.5 pl-2.5 pr-1 text-xs text-primary">
        {t('search.from')} {value.name}
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={t('common.cancel')}
          className="rounded-full p-0.5 hover:bg-primary/20"
        >
          <X className="size-3" />
        </button>
      </span>
    );
  }

  return (
    <div className="relative">
      <Input
        className="h-8 w-40"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder={t('search.fromPlaceholder')}
      />
      {term.trim() ? (
        <div className="absolute z-10 mt-1 max-h-48 w-56 overflow-y-auto rounded-md border border-border bg-surface p-1 shadow-lg">
          {(directory.data ?? [])
            .filter((u) => u.id !== meId)
            .slice(0, 6)
            .map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => {
                  onChange({ id: u.id, name: u.shortName });
                  setTerm('');
                }}
                className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-surface-2"
              >
                {u.shortName}
              </button>
            ))}
        </div>
      ) : null}
    </div>
  );
}

/** Wrap case-insensitive matches of any query word in a highlight — plain React text, so it is safe. */
function highlight(text: string, query: string): React.ReactNode {
  const words = query
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (words.length === 0) return text;
  const parts = text.split(new RegExp(`(${words.join('|')})`, 'gi'));
  const lower = new Set(words.map((w) => w.toLowerCase()));
  return parts.map((part, i) =>
    lower.has(part.toLowerCase()) ? (
      <mark key={i} className="rounded bg-warning/30 text-text">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}
