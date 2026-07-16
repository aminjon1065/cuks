import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LayoutContextProvider,
  LiveKitRoom,
  RoomAudioRenderer,
  type LocalUserChoices,
} from '@livekit/components-react';
import '@livekit/components-styles';
import { Loader2, VideoOff } from 'lucide-react';
import type { MeetRoomDto, MeetTokenDto } from '@cuks/shared';
import { Button, EmptyState } from '@cuks/ui';
import { ApiError } from '@/lib/api-client';
import { useMintToken } from '../api/queries';
import { ConferenceStage } from './ConferenceStage';
import { CallControlBar, type CallPanel } from './CallControlBar';
import { ParticipantsPanel } from './ParticipantsPanel';
import { RoomChatPanel } from './RoomChatPanel';
import { RecordingBadge } from './RecordingBadge';
import { ReactionsOverlay } from './ReactionsOverlay';
import { useIncomingVideo } from '../hooks/useIncomingVideo';
import { useReactions } from '../hooks/useReactions';
import './meet.css';

interface Props {
  room: MeetRoomDto;
  choices: LocalUserChoices;
  onLeave: () => void;
}

/** Mint a join token, then connect the LiveKit room (docs/modules/14 §3/§6). */
export function CallRoom({ room, choices, onLeave }: Props): React.JSX.Element {
  const { t } = useTranslation('meet');
  const mint = useMintToken();
  const [creds, setCreds] = useState<MeetTokenDto | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    mint.mutate(room.id, { onSuccess: setCreds, onError: (err) => setFailed(err) });
  }, [mint, room.id]);

  if (failed) {
    const status = failed instanceof ApiError ? failed.status : 0;
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface-0 p-6">
        <EmptyState
          icon={VideoOff}
          title={status === 403 ? t('error.forbidden') : t('error.unavailable')}
          description={status === 403 ? t('error.forbiddenBody') : undefined}
          action={
            <Button variant="secondary" onClick={onLeave}>
              {t('error.backToMeet')}
            </Button>
          }
        />
      </div>
    );
  }

  if (!creds) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface-0 text-text-muted">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={creds.url}
      token={creds.token}
      connect
      video={choices.videoEnabled}
      audio={choices.audioEnabled}
      options={{ adaptiveStream: true, dynacast: true }}
      onDisconnected={onLeave}
      data-lk-theme="default"
      className="h-full w-full bg-surface-0"
    >
      <RoomAudioRenderer />
      <LayoutContextProvider>
        <ConnectedRoom room={room} onLeave={onLeave} />
      </LayoutContextProvider>
    </LiveKitRoom>
  );
}

function ConnectedRoom({
  room,
  onLeave,
}: {
  room: MeetRoomDto;
  onLeave: () => void;
}): React.JSX.Element {
  const [panel, setPanel] = useState<CallPanel>(null);
  const [audioOnly, setAudioOnly] = useState(false);
  useIncomingVideo(audioOnly);
  const { reactions, react } = useReactions();

  return (
    <div className="flex h-full min-h-0 w-full">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          <ConferenceStage />
          <RecordingBadge />
          <ReactionsOverlay reactions={reactions} />
        </div>
        <CallControlBar
          room={room}
          onLeave={onLeave}
          panel={panel}
          onTogglePanel={(p) => setPanel((cur) => (cur === p ? null : p))}
          audioOnly={audioOnly}
          onToggleAudioOnly={setAudioOnly}
          onReact={react}
        />
      </div>
      {panel === 'participants' ? (
        <ParticipantsPanel room={room} onClose={() => setPanel(null)} />
      ) : null}
      {panel === 'chat' ? <RoomChatPanel onClose={() => setPanel(null)} /> : null}
    </div>
  );
}
