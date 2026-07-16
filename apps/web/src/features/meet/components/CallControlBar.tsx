import { useTranslation } from 'react-i18next';
import { MediaDeviceMenu, useRoomContext, useTrackToggle } from '@livekit/components-react';
import { Track } from 'livekit-client';
import {
  Hand,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Settings,
  Smile,
  Users,
  Video,
  VideoOff,
} from 'lucide-react';
import type { MeetRoomDto } from '@cuks/shared';
import { Button, Popover, PopoverContent, PopoverTrigger, cn } from '@cuks/ui';
import { usePushToTalk } from '../hooks/usePushToTalk';
import { useRaiseHand } from '../hooks/useRaiseHand';

export type CallPanel = 'participants' | 'chat' | null;

const REACTION_EMOJI = ['👍', '👏', '🎉', '❤️', '😂', '😮', '🙏'];

interface Props {
  room: MeetRoomDto;
  onLeave: () => void;
  panel: CallPanel;
  onTogglePanel: (p: 'participants' | 'chat') => void;
  audioOnly: boolean;
  onToggleAudioOnly: (v: boolean) => void;
  onReact: (emoji: string) => void;
}

function ControlButton({
  icon: Icon,
  label,
  active,
  danger,
  onClick,
}: {
  icon: typeof Mic;
  label: string;
  active?: boolean;
  danger?: boolean;
  onClick?: () => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'flex size-10 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text',
        active && 'bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary',
        danger && 'bg-danger/15 text-danger hover:bg-danger/25 hover:text-danger',
      )}
    >
      <Icon className="size-5" />
    </button>
  );
}

/** Bottom controls (docs/modules/14 §3): mic (with push-to-talk), camera, screen-share, raise hand,
 *  reactions, participants, room chat, audio-only, device settings and leave. */
export function CallControlBar(props: Props): React.JSX.Element {
  const { t } = useTranslation('meet');
  const room = useRoomContext();
  const mic = useTrackToggle({ source: Track.Source.Microphone });
  const camera = useTrackToggle({ source: Track.Source.Camera });
  const screen = useTrackToggle({ source: Track.Source.ScreenShare });
  const ptt = usePushToTalk();
  const hand = useRaiseHand();

  return (
    <div className="flex items-center justify-center gap-1.5 border-t border-border bg-surface-1 px-3 py-2">
      <div className="flex items-center gap-0.5">
        <ControlButton
          icon={mic.enabled ? Mic : MicOff}
          label={ptt ? t('room.pushToTalkHint') : mic.enabled ? t('room.mic') : t('room.micOff')}
          active={mic.enabled}
          danger={!mic.enabled}
          onClick={() => void mic.toggle()}
        />
        <ControlButton
          icon={camera.enabled ? Video : VideoOff}
          label={camera.enabled ? t('room.camera') : t('room.cameraOff')}
          active={camera.enabled}
          onClick={() => void camera.toggle()}
        />
        <ControlButton
          icon={MonitorUp}
          label={screen.enabled ? t('room.stopShare') : t('room.share')}
          active={screen.enabled}
          onClick={() => void screen.toggle()}
        />
      </div>

      <span className="mx-1 h-6 w-px bg-border" />

      <ControlButton
        icon={Hand}
        label={hand.raised ? t('room.lowerHand') : t('room.raiseHand')}
        active={hand.raised}
        onClick={hand.toggle}
      />

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t('room.reactions')}
            title={t('room.reactions')}
            className="flex size-10 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <Smile className="size-5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-1.5">
          <div className="flex gap-1">
            {REACTION_EMOJI.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => props.onReact(emoji)}
                className="flex size-9 items-center justify-center rounded-md text-lg hover:bg-surface-2"
              >
                {emoji}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>

      <span className="mx-1 h-6 w-px bg-border" />

      <ControlButton
        icon={Users}
        label={t('room.participants')}
        active={props.panel === 'participants'}
        onClick={() => props.onTogglePanel('participants')}
      />
      <ControlButton
        icon={MessageSquare}
        label={t('room.chat')}
        active={props.panel === 'chat'}
        onClick={() => props.onTogglePanel('chat')}
      />
      <ControlButton
        icon={VideoOff}
        label={props.audioOnly ? t('room.enableIncomingVideo') : t('room.disableIncomingVideo')}
        active={props.audioOnly}
        onClick={() => props.onToggleAudioOnly(!props.audioOnly)}
      />

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={t('room.settings')}
            title={t('room.settings')}
            className="flex size-10 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
          >
            <Settings className="size-5" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-64 space-y-3" data-lk-theme="default">
          <div className="space-y-1">
            <p className="text-[12px] font-medium text-text-muted">{t('room.mic')}</p>
            <MediaDeviceMenu kind="audioinput" />
          </div>
          <div className="space-y-1">
            <p className="text-[12px] font-medium text-text-muted">{t('room.camera')}</p>
            <MediaDeviceMenu kind="videoinput" />
          </div>
        </PopoverContent>
      </Popover>

      <span className="mx-1 h-6 w-px bg-border" />

      <Button variant="danger" onClick={() => void room.disconnect()} className="gap-2">
        <PhoneOff className="size-4" />
        {t('room.leave')}
      </Button>
    </div>
  );
}
