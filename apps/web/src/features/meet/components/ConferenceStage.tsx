import { useTranslation } from 'react-i18next';
import {
  CarouselLayout,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  ParticipantTile,
  isTrackReference,
  usePagination,
  usePinnedTracks,
  useTracks,
} from '@livekit/components-react';
import { RoomEvent, Track } from 'livekit-client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@cuks/ui';

/** Up to a 5×5 grid per page (docs/modules/14 §3), then paginate. */
const TILES_PER_PAGE = 25;

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

  const pagination = usePagination(TILES_PER_PAGE, cameraTracks);

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

  return (
    <div className="flex h-full flex-col">
      <GridLayout tracks={pagination.tracks} className="flex-1">
        <ParticipantTile />
      </GridLayout>
      {pagination.totalPageCount > 1 ? (
        <div className="flex items-center justify-center gap-3 py-2 text-[13px] text-text-muted">
          <Button size="icon" variant="ghost" onClick={pagination.prevPage} aria-label="prev">
            <ChevronLeft className="size-4" />
          </Button>
          <span>
            {t('room.pageOf', {
              page: pagination.currentPage,
              total: pagination.totalPageCount,
            })}
          </span>
          <Button size="icon" variant="ghost" onClick={pagination.nextPage} aria-label="next">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
