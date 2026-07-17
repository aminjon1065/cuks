import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, RefreshCw, Video } from 'lucide-react';
import { Button, EmptyState, PageHeader, Skeleton } from '@cuks/ui';
import { useSocketEvent } from '@/lib/socket';
import { useDocumentTitle } from '@/lib/use-document-title';
import { recordingsKey, useRecordings } from '../api/queries';
import { RecordingCard } from '../components/RecordingCard';

/** «Записи» — the recordings the caller may access (docs/modules/14 §4). Refreshes live on the
 *  meet.recording.state event (a recording starts / becomes ready). */
export function MeetRecordingsPage(): React.JSX.Element {
  const { t } = useTranslation('meet');
  useDocumentTitle(t('recordings.title'));
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
          <>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-border bg-surface-1 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                  <Skeleton className="size-8" />
                </div>
                <Skeleton className="mt-3 h-40 w-full" />
              </div>
            ))}
          </>
        ) : recordings.isError ? (
          <EmptyState
            icon={Video}
            title={t('error.recordingsLoadFailed')}
            action={
              <Button
                variant="secondary"
                className="gap-1.5"
                onClick={() => void recordings.refetch()}
              >
                <RefreshCw className="size-4" />
                {t('retry')}
              </Button>
            }
          />
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
