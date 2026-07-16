import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { LocalUserChoices } from '@livekit/components-react';
import { Loader2, VideoOff } from 'lucide-react';
import type { MeetRoomDto } from '@cuks/shared';
import { Button, EmptyState } from '@cuks/ui';
import { ApiError } from '@/lib/api-client';
import { useRoom } from '../api/queries';
import { PreJoinScreen } from '../components/PreJoinScreen';
import { CallRoom } from '../components/CallRoom';

/** The call room (docs/modules/14 §3): load the room by slug, run pre-join, then connect. */
export function MeetRoomPage(): React.JSX.Element {
  const { slug } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation('meet');
  const room = useRoom(slug);
  const [choices, setChoices] = useState<LocalUserChoices | undefined>();

  if (room.isLoading) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface-0 text-text-muted">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  if (room.isError || !room.data) {
    const forbidden = room.error instanceof ApiError && room.error.status === 403;
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface-0 p-6">
        <EmptyState
          icon={VideoOff}
          title={forbidden ? t('error.forbidden') : t('error.notFound')}
          description={forbidden ? t('error.forbiddenBody') : t('error.notFoundBody')}
          action={
            <Button variant="secondary" onClick={() => navigate('/app/meet')}>
              {t('error.backToMeet')}
            </Button>
          }
        />
      </div>
    );
  }

  const meetRoom: MeetRoomDto = room.data;
  if (!choices) {
    return <PreJoinScreen onJoin={setChoices} onCancel={() => navigate('/app/meet')} />;
  }
  return <CallRoom room={meetRoom} choices={choices} onLeave={() => navigate('/app/meet')} />;
}
