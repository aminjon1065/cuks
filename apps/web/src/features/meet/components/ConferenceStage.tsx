import { useTranslation } from 'react-i18next';
import {
  CarouselLayout,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  ParticipantTile,
  isTrackReference,
  useMaybeTrackRefContext,
  useParticipantAttribute,
  usePinnedTracks,
  useTracks,
} from '@livekit/components-react';
import { Hand } from 'lucide-react';
import { RoomEvent, Track } from 'livekit-client';

/** ParticipantTile plus a raised-hand badge (docs/modules/14 §3): the attribute
 *  was previously readable only inside the (closed-by-default) roster panel, so
 *  a raised hand was invisible to everyone else. */
function StageTile(): React.JSX.Element {
  const trackRef = useMaybeTrackRefContext();
  const handRaised =
    useParticipantAttribute('handRaised', {
      ...(trackRef?.participant ? { participant: trackRef.participant } : {}),
    }) === '1';
  return (
    <div className="relative h-full w-full">
      <ParticipantTile className="h-full" />
      {handRaised ? (
        <span className="pointer-events-none absolute right-2 top-2 z-10 flex size-7 items-center justify-center rounded-full bg-primary text-primary-fg shadow-sm">
          <Hand className="size-4" />
        </span>
      ) : null}
    </div>
  );
}

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
          <StageTile />
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
      <StageTile />
    </GridLayout>
  );
}
