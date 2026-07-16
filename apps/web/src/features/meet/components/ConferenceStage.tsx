import { useTranslation } from 'react-i18next';
import {
  CarouselLayout,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  ParticipantTile,
  isTrackReference,
  usePinnedTracks,
  useTracks,
} from '@livekit/components-react';
import { RoomEvent, Track } from 'livekit-client';

/**
 * The video stage (docs/modules/14 §3): a grid of camera tiles, or a speaker/focus layout when a
 * screen-share is active or a participant is pinned (screen-share takes priority). ParticipantTile
 * carries the per-tile name, connection-quality and speaking indicators.
 */
export function ConferenceStage(): React.JSX.Element {
  const { t } = useTranslation('meet');
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { updateOnlyOn: [RoomEvent.ActiveSpeakersChanged], onlySubscribed: false },
  );

  const screenShare = tracks.find(
    (ref) => isTrackReference(ref) && ref.publication.source === Track.Source.ScreenShare,
  );
  const cameraTracks = tracks.filter((ref) => ref.source === Track.Source.Camera);
  const pinned = usePinnedTracks();
  const focus = pinned[0] ?? screenShare;

  if (focus) {
    return (
      <FocusLayoutContainer className="h-full">
        <CarouselLayout tracks={cameraTracks}>
          <ParticipantTile />
        </CarouselLayout>
        <FocusLayout trackRef={focus} />
      </FocusLayoutContainer>
    );
  }

  if (cameraTracks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-text-muted">
        {t('room.emptyStage')}
      </div>
    );
  }

  // GridLayout fits up to a 5×5 grid and paginates internally (with its own controls) beyond that —
  // pass the full track list so pagination happens exactly once (docs/modules/14 §3).
  return (
    <GridLayout tracks={cameraTracks} className="h-full">
      <ParticipantTile />
    </GridLayout>
  );
}
