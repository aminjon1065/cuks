import { useEffect } from 'react';
import { useRoomContext } from '@livekit/components-react';
import { RoomEvent } from 'livekit-client';

/**
 * Audio-only mode (docs/modules/14 §3, «отключить входящее видео»): when `disabled`, unsubscribe from
 * every remote video track (and re-apply as participants/tracks arrive) to save bandwidth on a bad
 * network. Re-enables all remote video when turned back off. `adaptiveStream`/`dynacast` handle the
 * automatic case; this is the explicit user switch.
 */
export function useIncomingVideo(disabled: boolean): void {
  const room = useRoomContext();

  useEffect(() => {
    const apply = (): void => {
      for (const participant of room.remoteParticipants.values()) {
        for (const publication of participant.videoTrackPublications.values()) {
          publication.setSubscribed(!disabled);
        }
      }
    };
    apply();
    room.on(RoomEvent.TrackPublished, apply);
    room.on(RoomEvent.ParticipantConnected, apply);
    return () => {
      room.off(RoomEvent.TrackPublished, apply);
      room.off(RoomEvent.ParticipantConnected, apply);
    };
  }, [room, disabled]);
}
