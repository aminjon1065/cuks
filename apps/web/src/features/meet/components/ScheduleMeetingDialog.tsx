import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MeetingDto, MeetingParticipants } from '@cuks/shared';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Switch,
} from '@cuks/ui';
import { ApiError } from '@/lib/api-client';
import { toast } from '@cuks/ui';
import { DateTimeField } from '@/features/tasks/components/DateTimeField';
import { useCreateMeeting, useUpdateMeeting } from '../api/queries';
import { MeetingParticipantsField } from './MeetingParticipantsField';

const DURATIONS = [15, 30, 45, 60, 90, 120];

/** Schedule or edit a meeting (docs/modules/14 §2). Mounted fresh per open (keyed by the parent) so
 *  it initialises from `meeting` once. */
export function ScheduleMeetingDialog({
  meeting,
  onClose,
}: {
  meeting?: MeetingDto | undefined;
  onClose: () => void;
}): React.JSX.Element {
  const { t } = useTranslation('meet');
  const create = useCreateMeeting();
  const update = useUpdateMeeting();

  const [title, setTitle] = useState(meeting?.title ?? '');
  const [startsAt, setStartsAt] = useState<string | null>(meeting?.startsAt ?? null);
  const [durationMin, setDurationMin] = useState(meeting?.durationMin || 60);
  const [participants, setParticipants] = useState<MeetingParticipants>(
    meeting?.participants ?? { users: [], orgUnits: [] },
  );
  const [agenda, setAgenda] = useState(meeting?.agenda ?? '');
  const [recordPlanned, setRecordPlanned] = useState(meeting?.recordPlanned ?? false);

  const pending = create.isPending || update.isPending;
  const valid = title.trim().length > 0 && !!startsAt;

  const onError = (err: unknown): void => {
    toast({
      title: err instanceof ApiError ? err.message : t('toast.actionFailed'),
      tone: 'danger',
    });
  };

  const submit = (): void => {
    if (!valid || !startsAt) return;
    const body = {
      title: title.trim(),
      startsAt,
      durationMin,
      participants,
      agenda: agenda.trim() || null,
      recordPlanned,
    };
    if (meeting) {
      update.mutate({ id: meeting.id, body }, { onSuccess: onClose, onError });
    } else {
      create.mutate(body, { onSuccess: onClose, onError });
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{meeting ? t('schedule.editTitle') : t('schedule.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="meeting-title">{t('schedule.topic')}</Label>
            <Input
              id="meeting-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('schedule.topicPlaceholder')}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{t('schedule.startsAt')}</Label>
              <DateTimeField value={startsAt} onChange={setStartsAt} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meeting-duration">{t('schedule.duration')}</Label>
              <select
                id="meeting-duration"
                value={durationMin}
                onChange={(e) => setDurationMin(Number(e.target.value))}
                className="h-9 w-full rounded-md border border-border bg-surface-1 px-2 text-[13px] text-text"
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {t('schedule.minutes', { count: d })}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <MeetingParticipantsField
            value={participants}
            onChange={setParticipants}
            knownNames={meeting?.participantUsers}
          />

          <div className="space-y-1.5">
            <Label htmlFor="meeting-agenda">{t('schedule.agenda')}</Label>
            <textarea
              id="meeting-agenda"
              value={agenda}
              onChange={(e) => setAgenda(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-surface-1 p-2 text-[13px] text-text"
              placeholder={t('schedule.agendaPlaceholder')}
            />
          </div>

          <label className="flex items-center justify-between">
            <span className="text-[13px] text-text">{t('schedule.record')}</span>
            <Switch checked={recordPlanned} onCheckedChange={setRecordPlanned} />
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={submit} disabled={!valid || pending}>
            {meeting ? t('schedule.save') : t('schedule.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
