import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { MessageSquare } from 'lucide-react';
import { EmptyState, SidePanel, Skeleton, cn } from '@cuks/ui';
import { useMe } from '@/features/auth/api/queries';
import { ConversationList } from '../components/ConversationList';
import { ChannelFeed } from '../components/ChannelFeed';
import { InfoPanel } from '../components/InfoPanel';
import { SearchDialog } from '../components/SearchDialog';
import { useChannel } from '../api/queries';
import '../chat.css';

/** Chat screen (docs/modules/13 §7): three columns — conversations, the active channel's feed, and an
 *  info panel. On desktop the info panel is a persistent third column; below 1024px it is an overlay,
 *  and below 768px the columns stack (the list yields to the feed once a channel is open). */
export function ChatPage(): React.JSX.Element | null {
  const { t } = useTranslation('chat');
  const { channelId } = useParams();
  const navigate = useNavigate();
  const me = useMe();
  const [infoOpen, setInfoOpen] = useState(false);
  const [search, setSearch] = useState<{ open: boolean; channelId?: string }>({ open: false });
  const isDesktop = useIsDesktop();

  useEffect(() => setInfoOpen(false), [channelId]);

  if (!me.data) return null;
  const meArg = { id: me.data.id, name: me.data.shortName };
  const select = (id: string): void => void navigate(`/app/chat/${id}`);
  const back = (): void => void navigate('/app/chat');
  const closeAndBack = (): void => {
    setInfoOpen(false);
    void navigate('/app/chat');
  };
  const jumpTo = (ch: string, messageId: string): void =>
    void navigate(`/app/chat/${ch}?msg=${messageId}`);

  const infoAsAside = infoOpen && isDesktop && !!channelId;
  const infoAsOverlay = infoOpen && !isDesktop && !!channelId;

  return (
    <div className="flex h-full min-h-0">
      <aside
        className={cn(
          'w-full min-w-0 border-r border-border md:flex md:w-80 md:shrink-0',
          channelId ? 'hidden md:flex' : 'flex',
        )}
      >
        <ConversationList
          meId={me.data.id}
          activeChannelId={channelId}
          onSelect={select}
          onOpenSearch={() => setSearch({ open: true })}
        />
      </aside>

      <main className={cn('min-h-0 min-w-0 flex-1', channelId ? 'flex' : 'hidden md:flex')}>
        {channelId ? (
          <div className="flex min-h-0 w-full flex-col">
            {/* Key by channelId: switching channels must remount the feed so the virtualized list's
                scroll state (and any half-typed composer draft) resets to the new channel. */}
            <ChannelFeed
              key={channelId}
              channelId={channelId}
              me={meArg}
              infoOpen={infoOpen}
              onToggleInfo={() => setInfoOpen((v) => !v)}
              onBack={back}
              onOpenSearch={() => setSearch({ open: true, channelId })}
            />
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center p-6">
            <EmptyState
              icon={MessageSquare}
              title={t('feed.selectPrompt')}
              description={t('feed.selectHint')}
            />
          </div>
        )}
      </main>

      {infoAsAside ? (
        <aside className="w-80 shrink-0 border-l border-border">
          <InfoPanelContainer channelId={channelId!} meId={me.data.id} onLeft={closeAndBack} />
        </aside>
      ) : null}

      {infoAsOverlay ? (
        <SidePanel open onOpenChange={(o) => !o && setInfoOpen(false)} title={t('info.title')}>
          <InfoPanelContainer channelId={channelId!} meId={me.data.id} onLeft={closeAndBack} />
        </SidePanel>
      ) : null}

      {search.open ? (
        <SearchDialog
          meId={me.data.id}
          presetChannelId={search.channelId}
          onClose={() => setSearch({ open: false })}
          onJump={jumpTo}
        />
      ) : null}
    </div>
  );
}

function InfoPanelContainer({
  channelId,
  meId,
  onLeft,
}: {
  channelId: string;
  meId: string;
  onLeft: () => void;
}): React.JSX.Element {
  const channel = useChannel(channelId);
  if (!channel.data) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-16 rounded-md" />
        <Skeleton className="h-24 rounded-md" />
      </div>
    );
  }
  return <InfoPanel channel={channel.data} meId={meId} onLeft={onLeft} />;
}

/** True at ≥1024px — where the info panel becomes a persistent third column (docs/06 §7). */
function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const sync = (): void => setDesktop(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);
  return desktop;
}
