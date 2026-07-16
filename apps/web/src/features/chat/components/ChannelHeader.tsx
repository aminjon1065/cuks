import { useTranslation } from 'react-i18next';
import { ChevronLeft, Hash, Info, Lock, Users } from 'lucide-react';
import { Avatar, AvatarFallback, Button, cn } from '@cuks/ui';
import type { ChannelDto } from '@cuks/shared';
import { channelDisplayName, initials } from '../lib/grouping';

/** Channel header: name + kind, topic, a member-avatar stack and the info toggle (docs/modules/13 §7).
 *  On mobile the back button returns to the conversation list. */
export function ChannelHeader({
  channel,
  infoOpen,
  onToggleInfo,
  onBack,
}: {
  channel: ChannelDto;
  infoOpen: boolean;
  onToggleInfo: () => void;
  onBack: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('chat');
  const name = channelDisplayName(channel, t('kind.dm'));
  const isDm = channel.kind === 'dm' || channel.kind === 'group';
  const Icon = channel.kind === 'private' ? Lock : Hash;
  const shown = channel.members.slice(0, 4);
  const extra = channel.memberCount - shown.length;

  return (
    <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
      <Button
        size="icon"
        variant="ghost"
        className="md:hidden"
        onClick={onBack}
        aria-label={t('aria.back')}
      >
        <ChevronLeft className="size-4" />
      </Button>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {!isDm ? <Icon className="size-4 shrink-0 text-text-muted" /> : null}
          <h1 className="truncate text-[15px] font-semibold text-text">{name}</h1>
        </div>
        {channel.topic ? (
          <p className="truncate text-xs text-text-muted">{channel.topic}</p>
        ) : (
          <p className="flex items-center gap-1 text-xs text-text-muted">
            <Users className="size-3" /> {t('feed.membersCount', { count: channel.memberCount })}
          </p>
        )}
      </div>

      <div className="hidden items-center -space-x-2 sm:flex">
        {shown.map((m) => (
          <Avatar key={m.userId} className="size-7 border-2 border-surface">
            <AvatarFallback className="text-[10px]">{initials(m.name)}</AvatarFallback>
          </Avatar>
        ))}
        {extra > 0 ? (
          <span className="flex size-7 items-center justify-center rounded-full border-2 border-surface bg-surface-2 text-[10px] font-medium text-text-muted">
            +{extra}
          </span>
        ) : null}
      </div>

      <Button
        size="icon"
        variant={infoOpen ? 'secondary' : 'ghost'}
        onClick={onToggleInfo}
        aria-label={t('aria.openInfo')}
        aria-pressed={infoOpen ? 'true' : 'false'}
        className={cn(infoOpen && 'text-primary')}
      >
        <Info className="size-4" />
      </Button>
    </header>
  );
}
