import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  LayoutContextProvider,
  RoomAudioRenderer,
  RoomContext,
  type LocalUserChoices,
} from '@livekit/components-react';
import { Room, RoomEvent } from 'livekit-client';
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

/** Mint a join token, then connect the LiveKit room (docs/modules/14 §3/§6).
 *
 * The connection is managed HERE, imperatively, not by `<LiveKitRoom connect>`:
 * that component wires `room.disconnect()` into an unmount effect, so React
 * StrictMode's dev double-mount aborts the first in-flight connect
 * («ConnectionError: Client initiated disconnect») and a re-issued connect on
 * the same Room wedges inside livekit-client — an endless spinner with no WS
 * frame ever reaching the SFU (diagnosed live against the dev stack). Deferring
 * our own `connect()` by one macrotask whose timer the effect cleanup cancels
 * means the throwaway strict-mount never starts connecting at all; only the
 * surviving mount connects — exactly once, in dev and prod alike. The LiveKit
 * UI components get the Room through `RoomContext.Provider`, which is all
 * `<LiveKitRoom>` gave them anyway. */
export function CallRoom({ room, choices, onLeave }: Props): React.JSX.Element {
  const { t } = useTranslation('meet');
  const mint = useMintToken();
  const [creds, setCreds] = useState<MeetTokenDto | null>(null);
  const [failed, setFailed] = useState<unknown>(null);
  const [connected, setConnected] = useState(false);
  const [slow, setSlow] = useState(false);
  const started = useRef(false);
  // One Room per CallRoom mount; options mirror the previous <LiveKitRoom> ones.
  const [lkRoom] = useState(() => new Room({ adaptiveStream: true, dynacast: true }));
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;
  const choicesRef = useRef(choices);
  choicesRef.current = choices;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // mutateAsync, NOT mutate(id, { onSuccess }): react-query drops per-mutate
    // callbacks once the mutation observer of StrictMode's throwaway render is
    // replaced, so onSuccess silently never fired in dev — the token arrived
    // over the wire (201) yet creds stayed null, which was the REAL root of the
    // endless join spinner. A promise settles regardless of observer identity.
    mint
      .mutateAsync(room.id)
      .then(setCreds)
      .catch((err: unknown) => setFailed(err));
  }, [mint, room.id]);

  useEffect(() => {
    if (!creds) return;
    let cancelled = false;
    const handleDisconnected = (): void => {
      if (!cancelled) onLeaveRef.current();
    };
    lkRoom.on(RoomEvent.Disconnected, handleDisconnected);
    const timer = window.setTimeout(() => {
      lkRoom
        .connect(creds.url, creds.token)
        .then(() => {
          if (cancelled) return;
          setConnected(true);
          // Honour the exact camera/mic picked on the pre-join screen. Device
          // failures must not kill the call — degraded participation beats none.
          const picked = choicesRef.current;
          const local = lkRoom.localParticipant;
          void Promise.all([
            local.setMicrophoneEnabled(
              picked.audioEnabled,
              picked.audioDeviceId ? { deviceId: picked.audioDeviceId } : undefined,
            ),
            local.setCameraEnabled(
              picked.videoEnabled,
              picked.videoDeviceId ? { deviceId: picked.videoDeviceId } : undefined,
            ),
          ]).catch((err: unknown) => {
            console.warn('[meet] enabling devices failed:', err);
          });
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          console.error('[meet] room connect failed:', creds.url, err);
          setFailed(err);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      lkRoom.off(RoomEvent.Disconnected, handleDisconnected);
      void lkRoom.disconnect();
    };
  }, [creds, lkRoom]);

  // Surface a "taking longer than usual" hint while the SFU connect is pending —
  // the difference between a healthy handshake (<1s) and a blocked WebSocket.
  useEffect(() => {
    if (!creds || connected) return;
    const id = window.setTimeout(() => setSlow(true), 10_000);
    return () => window.clearTimeout(id);
  }, [creds, connected]);

  if (failed) {
    const status = failed instanceof ApiError ? failed.status : 0;
    // Raw failure detail (an SFU connect error, or an API error message): shown
    // small under the localized title — without it a connect failure is
    // indistinguishable from the spinner it used to hide behind.
    const detail = failed instanceof Error ? failed.message : String(failed);
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface-0 p-6">
        <EmptyState
          icon={VideoOff}
          title={status === 403 ? t('error.forbidden') : t('error.unavailable')}
          description={status === 403 ? t('error.forbiddenBody') : detail}
          action={
            <Button variant="secondary" onClick={onLeave}>
              {t('error.backToMeet')}
            </Button>
          }
        />
      </div>
    );
  }

  if (!creds || !connected) {
    // A silent spinner hid every failure mode this screen ever had; name the
    // stage instead, and after 10s point at the network — the SFU connect
    // timeout will then surface the exact error above.
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 bg-surface-0 text-text-muted">
        <Loader2 className="size-6 animate-spin" />
        <p className="text-[13px]">
          {creds ? t('connectStage.connecting') : t('connectStage.minting')}
        </p>
        {slow ? <p className="max-w-sm text-center text-xs">{t('connectStage.slow')}</p> : null}
      </div>
    );
  }

  return (
    <div data-lk-theme="default" className="h-full w-full bg-surface-0">
      <RoomContext.Provider value={lkRoom}>
        <RoomAudioRenderer />
        <LayoutContextProvider>
          <ConnectedRoom room={room} onLeave={onLeave} />
        </LayoutContextProvider>
      </RoomContext.Provider>
    </div>
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
