import { useTranslation } from 'react-i18next';
import { AlertCircle, CheckCircle2, Loader2, X } from 'lucide-react';
import { Button } from '@cuks/ui';
import { useUploadStore } from '../api/uploads';
import { formatBytes } from '../lib';

/** Global upload progress dock (docs/modules/12 §4: progress persists across
 *  navigation). Mounted once in FilesPage; driven by the upload store. */
export function UploadDock(): React.JSX.Element | null {
  const { t } = useTranslation('files');
  const items = useUploadStore((s) => s.items);
  const clearFinished = useUploadStore((s) => s.clearFinished);

  if (items.length === 0) return null;

  const active = items.filter((i) => i.status !== 'done' && i.status !== 'error').length;
  const done = items.filter((i) => i.status === 'done').length;

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 overflow-hidden rounded-lg border border-border bg-surface shadow-[0_4px_12px_rgba(15,23,42,.10)]">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-[13px] font-medium text-text">
          {active > 0
            ? t('upload.countActive', { done, total: items.length })
            : t('upload.allDone', { total: done })}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={t('upload.clear')}
          onClick={clearFinished}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <ul className="max-h-64 overflow-y-auto">
        {items.map((it) => {
          const pct = it.size > 0 ? Math.round((it.uploaded / it.size) * 100) : 0;
          return (
            <li key={it.id} className="px-3 py-2">
              <div className="flex items-center gap-2">
                {it.status === 'done' ? (
                  <CheckCircle2 className="size-4 shrink-0 text-success" />
                ) : it.status === 'error' ? (
                  <AlertCircle className="size-4 shrink-0 text-danger" />
                ) : (
                  <Loader2 className="size-4 shrink-0 animate-spin text-text-muted" />
                )}
                <span className="truncate text-[13px] text-text">{it.name}</span>
                <span className="ml-auto shrink-0 text-xs text-text-muted">
                  {it.status === 'error'
                    ? t('upload.failed')
                    : it.status === 'done'
                      ? t('upload.done')
                      : `${pct}%`}
                </span>
              </div>
              {it.status !== 'done' && it.status !== 'error' ? (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full bg-primary transition-[width] duration-200"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              ) : null}
              {it.status === 'error' ? (
                <p className="mt-0.5 truncate text-xs text-danger">{it.error}</p>
              ) : (
                <p className="mt-0.5 text-xs text-text-muted">{formatBytes(it.size)}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
