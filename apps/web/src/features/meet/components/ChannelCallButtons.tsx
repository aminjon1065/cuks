import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Phone, Video } from 'lucide-react';
import type { ChannelDto } from '@cuks/shared';
import { Button, toast } from '@cuks/ui';
import { ApiError } from '@/lib/api-client';
import { useMe } from '@/features/auth/api/queries';
import { useCreateRoom, useStartRing } from '../api/queries';

/**
 * Start-a-call buttons for a conversation header (docs/modules/14 §2). A 1:1 DM opens the room and
 * rings the other member; a channel/group opens (or joins) the room and raises its banner for everyone
 * — no per-user ring. Either way the caller navigates into the room.
 */
export function ChannelCallButtons({ channel }: { channel: ChannelDto }): React.JSX.Element {
  const { t } = useTranslation('meet');
  const navigate = useNavigate();
  const me = useMe();
  const createRoom = useCreateRoom();
  const startRing = useStartRing();

  const isDm = channel.kind === 'dm';
  const other = isDm ? channel.members.find((m) => m.userId !== me.data?.id) : undefined;
  const pending = createRoom.isPending;

  const call = (media: 'audio' | 'video'): void => {
    createRoom.mutate(
      { kind: isDm ? 'dm' : 'channel', channelId: channel.id },
      {
        onSuccess: (room) => {
          if (isDm && other) startRing.mutate({ roomId: room.id, userId: other.userId, media });
          navigate(`/app/meet/r/${room.slug}`);
        },
        onError: (err) =>
          toast({
            title: err instanceof ApiError ? err.message : t('toast.actionFailed'),
            tone: 'danger',
          }),
      },
    );
  };

  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        onClick={() => call('audio')}
        disabled={pending}
        aria-label={t('call.audio')}
      >
        <Phone className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        onClick={() => call('video')}
        disabled={pending}
        aria-label={t('call.video')}
      >
        <Video className="size-4" />
      </Button>
    </>
  );
}
