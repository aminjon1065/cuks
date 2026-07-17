import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileUp, TriangleAlert } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FileDropzone,
  Input,
  Label,
  Skeleton,
  toast,
} from '@cuks/ui';
import { GIS_IMPORT_MAX_BYTES } from '@cuks/shared';
import { ApiError } from '@/lib/api-client';
import { formatBytes } from '@/lib/format';
import { mapKey, useGisImport, useStartGisImport } from '../api/queries';

export interface ImportLayerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The created layer becomes visible on the map. */
  onImported: (layerId: string) => void;
}

/** Extensions the server accepts (docs/modules/10 §6). */
const ACCEPT = ['.geojson', '.json', '.zip', '.kml', '.gpkg', '.csv'];

/**
 * Import wizard (docs/modules/10 §6): pick a file → it uploads straight to storage
 * and the worker reads it → the preview (fields, object count, extent) → the layer
 * is in the registry and on the map. Errors come back as the worker's per-row log,
 * not as a single opaque failure.
 */
export function ImportLayerDialog({
  open,
  onOpenChange,
  onImported,
}: ImportLayerDialogProps): React.JSX.Element {
  const { t, i18n } = useTranslation('map');
  const queryClient = useQueryClient();
  const startImport = useStartGisImport();
  const [title, setTitle] = useState('');
  const [importId, setImportId] = useState<string | null>(null);
  const record = useGisImport(importId);

  const status = record.data?.status ?? (startImport.isPending ? 'processing' : null);
  const running = status === 'pending' || status === 'processing';
  const done = record.data?.status === 'done';
  const failed = record.data?.status === 'failed';

  // A finished import adds a layer to the registry: refresh it, and let the page
  // show the result on the map.
  useEffect(() => {
    if (done && record.data?.layerId) {
      void queryClient.invalidateQueries({ queryKey: [...mapKey, 'layers'] });
      onImported(record.data.layerId);
    }
  }, [done, onImported, queryClient, record.data?.layerId]);

  const close = (): void => {
    onOpenChange(false);
    setTitle('');
    setImportId(null);
    startImport.reset();
  };

  const onFiles = (files: File[]): void => {
    const file = files[0];
    if (!file) return;
    if (file.size > GIS_IMPORT_MAX_BYTES) {
      toast({
        title: t('import.tooLarge', { max: formatBytes(GIS_IMPORT_MAX_BYTES) }),
        tone: 'danger',
      });
      return;
    }
    startImport.mutate(
      { file, ...(title.trim() ? { title: title.trim() } : {}) },
      {
        onSuccess: (created) => setImportId(created.id),
        onError: (error) => {
          // Server errors carry a stable code (docs/04 §REST); the message is an
          // English log line, so localize the codes we know and fall back for the rest.
          const code = error instanceof ApiError ? error.code : null;
          const key = code ? `errors.${code}` : null;
          toast({
            title: key && i18n.exists(`map:${key}`) ? t(key) : t('import.failed'),
            tone: 'danger',
          });
        },
      },
    );
  };

  const preview = record.data?.preview;

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? onOpenChange(true) : close())}>
      <DialogContent closeLabel={t('drawn.close')} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('import.title')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4" data-testid="import-dialog">
          {!importId && !startImport.isPending && (
            <>
              <div className="space-y-2">
                <Label htmlFor="import-title">{t('import.layerTitle')}</Label>
                <Input
                  id="import-title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder={t('import.layerTitlePlaceholder')}
                  maxLength={200}
                />
              </div>
              <FileDropzone
                accept={ACCEPT.join(',')}
                onFiles={onFiles}
                label={t('import.dropzone')}
                hint={t('import.formats')}
              />
            </>
          )}

          {(startImport.isPending || running) && (
            <div className="space-y-2" data-testid="import-progress">
              <p className="text-sm text-text">{t('import.running')}</p>
              <Skeleton className="h-2 w-full" />
              <p className="text-xs text-text-muted">{t('import.runningHint')}</p>
            </div>
          )}

          {done && preview && (
            <div className="space-y-3" data-testid="import-preview">
              <div className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="size-4" />
                {t('import.done', {
                  count: preview.featureCount,
                  skipped: preview.skippedCount,
                })}
              </div>
              <dl className="space-y-1.5 text-xs">
                <Row label={t('import.driver')} value={preview.driver} />
                <Row label={t('import.geometry')} value={preview.geometryType} />
                <Row
                  label={t('import.extent')}
                  value={
                    preview.extent
                      ? preview.extent.map((value) => value.toFixed(3)).join(', ')
                      : '—'
                  }
                />
                <Row
                  label={t('import.fields')}
                  value={preview.fields.map((field) => `${field.name} (${field.type})`).join(', ')}
                />
              </dl>
              {record.data?.log && (
                <details className="rounded-sm border border-border bg-surface-2 p-2">
                  <summary className="cursor-pointer text-xs text-text-muted">
                    {t('import.log')}
                  </summary>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-text">
                    {record.data.log}
                  </pre>
                </details>
              )}
            </div>
          )}

          {failed && (
            <div className="space-y-2" data-testid="import-error">
              <div className="flex items-center gap-2 text-sm text-danger">
                <TriangleAlert className="size-4" />
                {t('import.failed')}
              </div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-sm border border-border bg-surface-2 p-2 text-xs text-text">
                {record.data?.log}
              </pre>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant={done ? 'primary' : 'ghost'} onClick={close}>
            {done ? t('import.finish') : t('drawn.cancel')}
          </Button>
          {!importId && !startImport.isPending && (
            <span className="flex items-center gap-1 text-xs text-text-muted">
              <FileUp className="size-3.5" />
              {t('import.maxSize', { max: formatBytes(GIS_IMPORT_MAX_BYTES) })}
            </span>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-text-muted">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-text">{value}</dd>
    </div>
  );
}
