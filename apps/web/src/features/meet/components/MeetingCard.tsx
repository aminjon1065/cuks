import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { MoreVertical, Pencil, Users, Video, X } from 'lucide-react';
import type { MeetingDto } from '@cuks/shared';
import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  toast,
} from '@cuks/ui';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { useUpdateMeeting } from '../api/queries';

/** One meeting in the «Встречи» list (docs/modules/14 §2). */
export function MeetingCard({
  meeting,
  onEdit,
}: {
  meeting: MeetingDto;
  onEdit: (m: MeetingDto) => void;
}): React.JSX.Element {
  const { t } = useTranslation('meet');
  const navigate = useNavigate();
  const update = useUpdateMeeting();
  const [confirmCancel, setConfirmCancel] = useState(false);

  const cancelled = meeting.status === 'cancelled';
  const joinable = meeting.status === 'scheduled' || meeting.status === 'live';
  const manageable = meeting.canManage && meeting.status === 'scheduled';

  const doCancel = (): void =>
    update.mutate(
      { id: meeting.id, body: { status: 'cancelled' } },
      {
        onSuccess: () => setConfirmCancel(false),
        onError: (err) =>
          toast({
            title: err instanceof ApiError ? err.message : t('toast.actionFailed'),
            tone: 'danger',
          }),
      },
    );

  return (
    <div className="rounded-lg border border-border bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-medium text-text">{meeting.title}</h3>
            {cancelled ? (
              <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[11px] text-text-muted">
                {t('status.cancelled')}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 text-[13px] text-text-muted">
            {formatDateTime(meeting.startsAt)} ·{' '}
            {t('schedule.minutes', { count: meeting.durationMin })}
          </p>
          <p className="mt-1 flex items-center gap-1 text-xs text-text-muted">
            <Users className="size-3" />
            {t('room.participantsCount', { count: meeting.participantCount })}
            {meeting.organizerName ? ` · ${meeting.organizerName}` : ''}
          </p>
          {meeting.agenda ? (
            <p className="mt-2 line-clamp-2 text-[13px] text-text-muted">{meeting.agenda}</p>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {joinable ? (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={() => navigate(`/app/meet/r/${meeting.slug}`)}
            >
              <Video className="size-4" />
              {t('banner.join')}
            </Button>
          ) : null}
          {manageable ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={t('schedule.editTitle')}
                  className="flex size-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
                >
                  <MoreVertical className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onEdit(meeting)}>
                  <Pencil className="size-4" />
                  {t('schedule.edit')}
                </DropdownMenuItem>
                <DropdownMenuItem destructive onSelect={() => setConfirmCancel(true)}>
                  <X className="size-4" />
                  {t('schedule.cancelMeeting')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={t('schedule.cancelConfirmTitle')}
        description={t('schedule.cancelConfirmBody')}
        entityName={meeting.title}
        confirmLabel={t('schedule.cancelMeeting')}
        cancelLabel={t('cancel')}
        destructive
        loading={update.isPending}
        onConfirm={doCancel}
      />
    </div>
  );
}
