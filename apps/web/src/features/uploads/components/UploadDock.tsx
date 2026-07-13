import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { AttachmentList, Button, type AttachmentItem } from '@cuks/ui';
import { formatBytes } from '@/lib/format';
import { useUploadStore } from '../api/upload-store';

/** Global upload progress dock (docs/modules/12 §4: progress persists across
 *  navigation). Mounted once (e.g. in FilesPage); driven by the upload store and
 *  rendered with the reusable AttachmentList. */
export function UploadDock(): React.JSX.Element | null {
  const { t } = useTranslation('uploads');
  const items = useUploadStore((s) => s.items);
  const clearFinished = useUploadStore((s) => s.clearFinished);

  if (items.length === 0) return null;

  const active = items.filter((i) => i.status !== 'done' && i.status !== 'error').length;
  const done = items.filter((i) => i.status === 'done').length;

  const rows: AttachmentItem[] = items.map((it) => {
    const pct = it.size > 0 ? Math.round((it.uploaded / it.size) * 100) : 0;
    return {
      id: it.id,
      name: it.name,
      status: it.status === 'done' || it.status === 'error' ? it.status : 'uploading',
      progress: it.size > 0 ? it.uploaded / it.size : 0,
      ...(it.status === 'error' ? { error: it.error ?? t('failed') } : {}),
      subLabel: formatBytes(it.size),
      meta: it.status === 'error' ? t('failed') : it.status === 'done' ? t('done') : `${pct}%`,
    };
  });

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 overflow-hidden rounded-lg border border-border bg-surface shadow-[0_4px_12px_rgba(15,23,42,.10)]">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[13px] font-medium text-text">
          {active > 0
            ? t('countActive', { done, total: items.length })
            : t('allDone', { total: done })}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={t('clear')}
          onClick={clearFinished}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <AttachmentList
        items={rows}
        variant="plain"
        labels={{ uploading: t('uploading') }}
        className="max-h-64 overflow-y-auto"
      />
    </div>
  );
}
