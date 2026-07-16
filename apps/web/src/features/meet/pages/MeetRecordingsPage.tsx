import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Loader2, Video } from 'lucide-react';
import { Button, EmptyState, PageHeader } from '@cuks/ui';
import { useSocketEvent } from '@/lib/socket';
import { recordingsKey, useRecordings } from '../api/queries';
import { RecordingCard } from '../components/RecordingCard';

/** «Записи» — the recordings the caller may access (docs/modules/14 §4). Refreshes live on the
 *  meet.recording.state event (a recording starts / becomes ready). */
export function MeetRecordingsPage(): React.JSX.Element {
  const { t } = useTranslation('meet');
  const navigate = useNavigate();
  const qc = useQueryClient();
  const recordings = useRecordings();

  const onState = useCallback(() => {
    void qc.invalidateQueries({ queryKey: recordingsKey });
  }, [qc]);
  useSocketEvent('meet.recording.state', onState);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader
        title={t('recordings.title')}
        description={t('recordings.subtitle')}
        actions={
          <Button variant="ghost" className="gap-1.5" onClick={() => navigate('/app/meet')}>
            <ArrowLeft className="size-4" />
            {t('error.backToMeet')}
          </Button>
        }
      />

      <div className="mt-4 space-y-3">
        {recordings.isPending ? (
          <div className="flex justify-center py-10 text-text-muted">
            <Loader2 className="size-5 animate-spin" />
          </div>
        ) : recordings.isError ? (
          <EmptyState icon={Video} title={t('toast.actionFailed')} />
        ) : (recordings.data?.length ?? 0) === 0 ? (
          <EmptyState
            icon={Video}
            title={t('recordings.empty')}
            description={t('recordings.emptyHint')}
          />
        ) : (
          recordings.data?.map((r) => <RecordingCard key={r.id} recording={r} />)
        )}
      </div>
    </div>
  );
}
