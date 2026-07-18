import { useTranslation } from 'react-i18next';
import {
  MediaDeviceMenu,
  useIsRecording,
  useParticipants,
  useRoomContext,
  useTrackToggle,
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import {
  Circle,
  Hand,
  Link2,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Settings,
  Smile,
  Square,
  Users,
  Video,
  VideoOff,
} from 'lucide-react';
import type { MeetRoomDto } from '@cuks/shared';
import { Button, Popover, PopoverContent, PopoverTrigger, cn, toast } from '@cuks/ui';
import { ApiError } from '@/lib/api-client';
import { useCan } from '@/lib/ability';
import { usePushToTalk } from '../hooks/usePushToTalk';
import { useRaiseHand } from '../hooks/useRaiseHand';
import { copyText, roomUrl } from '../lib/share';
import { useStartRecording, useStopRecording } from '../api/queries';

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
  const participants = useParticipants();
  const handsUp = participants.filter((p) => p.attributes?.handRaised === '1').length;
  const isRecording = useIsRecording();
  const canRecord = useCan('meet.record') && props.room.myRole === 'host';
  const startRec = useStartRecording();
  const stopRec = useStopRecording();

  const toggleHand = (): void => {
    // setAttributes waits for the SFU echo; a rejection means nobody saw the
    // hand — surface it instead of a button that silently lies.
    hand.toggle().catch(() => toast({ title: t('toast.actionFailed'), tone: 'danger' }));
  };

  const copyLink = (): void => {
    const url = roomUrl(props.room.slug);
    void copyText(url).then((ok) =>
      toast(
        ok
          ? { title: t('toast.linkCopied') }
          : { title: t('toast.linkCopyFailed', { url }), tone: 'danger' },
      ),
    );
  };

  /** Recording errors carry stable codes (docs/04 §errors); the raw server
   *  message is a fallback for codes this map does not know. */
  const recordingErrorTitle = (err: unknown): string => {
    if (!(err instanceof ApiError)) return t('toast.actionFailed');
    switch (err.code) {
      case 'meet.recording.start_failed':
      case 'meet.unavailable':
        return t('toast.recordUnavailable');
      case 'meet.recording.already':
        return t('toast.recordBusy');
      case 'meet.recording.slots_full':
        return t('toast.recordSlotsFull');
      default:
        return err.message;
    }
  };

  const toggleRecording = (): void => {
    // Ignore repeat clicks while a start/stop is in flight — a duplicate start would spin up a second
    // egress for the same room (the server also rejects it, but don't even fire the request).
    if (startRec.isPending || stopRec.isPending) return;
    const onError = (err: unknown): void => {
      toast({ title: recordingErrorTitle(err), tone: 'danger' });
    };
    if (isRecording) stopRec.mutate(props.room.id, { onError });
    else startRec.mutate(props.room.id, { onError });
  };

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
        onClick={toggleHand}
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

      <div className="relative">
        <ControlButton
          icon={Users}
          label={
            handsUp > 0
              ? `${t('room.participants')} · ${t('room.handsRaised', { count: handsUp })}`
              : t('room.participants')
          }
          active={props.panel === 'participants'}
          onClick={() => props.onTogglePanel('participants')}
        />
        {/* Raised hands must be visible with the roster CLOSED — the panel is
            the only other place a hand shows (docs/modules/14 acceptance §hand). */}
        {handsUp > 0 ? (
          <span className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-fg">
            {handsUp}
          </span>
        ) : null}
      </div>
      <ControlButton
        icon={MessageSquare}
        label={t('room.chat')}
        active={props.panel === 'chat'}
        onClick={() => props.onTogglePanel('chat')}
      />
      <ControlButton icon={Link2} label={t('room.copyLink')} onClick={copyLink} />
      <ControlButton
        icon={VideoOff}
        label={props.audioOnly ? t('room.enableIncomingVideo') : t('room.disableIncomingVideo')}
        active={props.audioOnly}
        onClick={() => props.onToggleAudioOnly(!props.audioOnly)}
      />
      {canRecord ? (
        <ControlButton
          icon={isRecording ? Square : Circle}
          label={isRecording ? t('room.stopRecord') : t('room.record')}
          active={isRecording}
          danger={isRecording}
          onClick={toggleRecording}
        />
      ) : null}

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
          <div className="space-y-1">
            <p className="text-[12px] font-medium text-text-muted">{t('room.speaker')}</p>
            <MediaDeviceMenu kind="audiooutput" />
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
