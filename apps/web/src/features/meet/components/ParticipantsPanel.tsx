import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useParticipants } from '@livekit/components-react';
import { Hand, MicOff, MoreVertical, UserX, VolumeX, X } from 'lucide-react';
import type { MeetRoomDto } from '@cuks/shared';
import {
  Avatar,
  AvatarFallback,
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  toast,
} from '@cuks/ui';
import { ApiError } from '@/lib/api-client';
import { useHostActions } from '../api/queries';

interface Props {
  room: MeetRoomDto;
  onClose: () => void;
}

/** Participants roster + host moderation (docs/modules/14 §3). Host authority comes from the room
 *  DTO (`myRole`, server-derived) — never from a client-mutable LiveKit metadata field. */
export function ParticipantsPanel({ room, onClose }: Props): React.JSX.Element {
  const { t } = useTranslation('meet');
  const participants = useParticipants();
  const isHost = room.myRole === 'host';
  const actions = useHostActions(room.id);
  const [confirmEnd, setConfirmEnd] = useState(false);

  const onFail = (err: unknown): void => {
    toast({
      title: err instanceof ApiError ? err.message : t('toast.actionFailed'),
      tone: 'danger',
    });
  };

  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-border bg-surface-1">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium text-text">
          {t('room.participantsCount', { count: participants.length })}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('cancel')}
          className="text-text-muted hover:text-text"
        >
          <X className="size-4" />
        </button>
      </header>

      {isHost ? (
        <div className="flex gap-2 border-b border-border px-3 py-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              actions.muteAll.mutate(undefined, {
                onSuccess: () => toast({ title: t('toast.muteAllDone') }),
                onError: onFail,
              })
            }
          >
            {t('host.muteAll')}
          </Button>
          <Button size="sm" variant="danger" onClick={() => setConfirmEnd(true)}>
            {t('host.endForAll')}
          </Button>
        </div>
      ) : null}

      <ul className="min-h-0 flex-1 overflow-y-auto py-1">
        {participants.map((p) => {
          const name = p.name || p.identity;
          const raised = p.attributes?.handRaised === '1';
          return (
            <li key={p.sid} className="flex items-center gap-2 px-3 py-1.5">
              <Avatar className="size-7">
                <AvatarFallback>{name.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1 truncate text-[13px] text-text">
                {name}
                {p.isLocal ? ` (${t('room.you')})` : ''}
              </span>
              {raised ? <Hand className="size-3.5 text-primary" /> : null}
              {!p.isMicrophoneEnabled ? <MicOff className="size-3.5 text-text-muted" /> : null}
              {isHost && !p.isLocal ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={t('host.actions')}
                      className="text-text-muted hover:text-text"
                    >
                      <MoreVertical className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onSelect={() =>
                        actions.mute.mutate(
                          { identity: p.identity },
                          { onSuccess: () => toast({ title: t('toast.muted') }), onError: onFail },
                        )
                      }
                    >
                      <VolumeX className="size-4" />
                      {t('host.mute')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      destructive
                      onSelect={() =>
                        actions.remove.mutate(
                          { identity: p.identity },
                          {
                            onSuccess: () => toast({ title: t('toast.removed') }),
                            onError: onFail,
                          },
                        )
                      }
                    >
                      <UserX className="size-4" />
                      {t('host.remove')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title={t('host.endConfirmTitle')}
        description={t('host.endConfirmBody')}
        confirmLabel={t('host.endForAll')}
        cancelLabel={t('cancel')}
        destructive
        loading={actions.end.isPending}
        onConfirm={() => actions.end.mutate(undefined, { onError: onFail })}
      />
    </aside>
  );
}
