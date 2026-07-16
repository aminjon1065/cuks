import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, Loader2, Trash2, TriangleAlert } from 'lucide-react';
import type { RecordingDto } from '@cuks/shared';
import { Button, ConfirmDialog, toast } from '@cuks/ui';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { useDeleteRecording } from '../api/queries';

function formatDuration(sec: number | null): string {
  if (!sec) return '—';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} ГБ` : `${Math.max(1, Math.round(mb))} МБ`;
}

/** One recording in the «Записи» list (docs/modules/14 §4): metadata + inline player + download/delete. */
export function RecordingCard({ recording }: { recording: RecordingDto }): React.JSX.Element {
  const { t } = useTranslation('meet');
  const del = useDeleteRecording();
  const [confirm, setConfirm] = useState(false);
  // Raw `/api/...` paths — a <video src>/<a href> can't use the react-query client's `/v1` base.
  const streamUrl = `/api/v1/meet/recordings/${recording.id}/stream`;
  const downloadUrl = `/api/v1/meet/recordings/${recording.id}/download`;
  const ready = recording.status === 'ready';

  return (
    <div className="rounded-lg border border-border bg-surface-1 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-text">{recording.title}</h3>
          <p className="mt-0.5 text-[13px] text-text-muted">
            {formatDateTime(recording.createdAt)}
            {recording.startedByName ? ` · ${recording.startedByName}` : ''}
          </p>
          <p className="mt-1 text-xs text-text-muted">
            {t('room.participantsCount', { count: recording.participantCount })}
            {ready
              ? ` · ${formatDuration(recording.durationSec)} · ${formatSize(recording.sizeBytes)}`
              : ''}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {ready ? (
            <a
              href={downloadUrl}
              className="flex size-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text"
              aria-label={t('recordings.download')}
              title={t('recordings.download')}
            >
              <Download className="size-4" />
            </a>
          ) : null}
          {recording.canManage ? (
            <Button
              size="icon"
              variant="ghost"
              aria-label={t('recordings.delete')}
              onClick={() => setConfirm(true)}
            >
              <Trash2 className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>

      {recording.status === 'processing' ? (
        <div className="mt-3 flex items-center gap-2 text-[13px] text-text-muted">
          <Loader2 className="size-4 animate-spin" />
          {t('recordings.processing')}
        </div>
      ) : recording.status === 'failed' ? (
        <div className="mt-3 flex items-center gap-2 text-[13px] text-danger">
          <TriangleAlert className="size-4" />
          {t('recordings.failed')}
        </div>
      ) : (
        <video
          controls
          preload="metadata"
          src={streamUrl}
          className="mt-3 w-full rounded-md bg-black"
        />
      )}

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t('recordings.deleteConfirmTitle')}
        description={t('recordings.deleteConfirmBody')}
        entityName={recording.title}
        confirmLabel={t('recordings.delete')}
        cancelLabel={t('cancel')}
        destructive
        loading={del.isPending}
        onConfirm={() =>
          del.mutate(recording.id, {
            onSuccess: () => setConfirm(false),
            onError: (err) =>
              toast({
                title: err instanceof ApiError ? err.message : t('toast.actionFailed'),
                tone: 'danger',
              }),
          })
        }
      />
    </div>
  );
}
