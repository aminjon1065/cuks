import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Download, TriangleAlert } from 'lucide-react';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Skeleton,
  toast,
} from '@cuks/ui';
import {
  GIS_EXPORT_FORMATS,
  type CreateGisExportInput,
  type GisExportFormat,
  type IncidentRegistryFilters,
} from '@cuks/shared';
import { ApiError } from '@/lib/api-client';
import { formatBytes } from '@/lib/format';
import { fetchGisExportUrl, useCreateGisExport, useGisExport } from '../api/queries';

interface NewExport {
  /** A registry layer, or the incidents matching the registry filters. */
  source: 'layer' | 'incidents';
  layerId?: string;
  filters?: IncidentRegistryFilters;
  /** Shown in the header so the user knows what they are exporting. */
  subject: string;
}

export interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Start a new export. Omit when opening an existing one. */
  request?: NewExport;
  /** Open an already-created export (deep-linked from its ready notification). */
  existingId?: string;
}

const selectClass = cn(
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

/**
 * Export a layer or an incident selection (docs/modules/10 §6). The work runs in
 * the `geo-export` worker — the dialog watches the record and offers the download
 * when it lands; the same result also arrives as a notification, so closing the
 * dialog does not lose it.
 */
export function ExportDialog({
  open,
  onOpenChange,
  request,
  existingId,
}: ExportDialogProps): React.JSX.Element {
  const { t, i18n } = useTranslation('map');
  const create = useCreateGisExport();
  const [format, setFormat] = useState<GisExportFormat>('geojson');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const exportId = existingId ?? createdId;
  const record = useGisExport(exportId);
  const subject = request?.subject ?? record.data?.fileName ?? '';

  const running =
    create.isPending || record.data?.status === 'pending' || record.data?.status === 'processing';
  const done = record.data?.status === 'done';
  const failed = record.data?.status === 'failed';

  const close = (): void => {
    onOpenChange(false);
    setCreatedId(null);
    create.reset();
  };

  // Server errors carry a stable code (docs/04 §REST); the message is an English
  // log line, so localize the codes we know and fall back for the rest.
  const showError = (error: unknown): void => {
    const code = error instanceof ApiError ? error.code : null;
    const key = code ? `errors.${code}` : null;
    toast({
      title: key && i18n.exists(`map:${key}`) ? t(key) : t('export.failed'),
      tone: 'danger',
    });
  };

  const submit = (): void => {
    if (!request) return;
    const input: CreateGisExportInput = {
      source: request.source,
      format,
      ...(request.source === 'layer' && request.layerId ? { layerId: request.layerId } : {}),
      ...(request.source === 'incidents' && request.filters ? { filters: request.filters } : {}),
    };
    create.mutate(input, {
      onSuccess: (created) => setCreatedId(created.id),
      onError: (error) => showError(error),
    });
  };

  const download = (): void => {
    if (!exportId) return;
    void fetchGisExportUrl(exportId)
      .then(({ url }) => {
        window.location.href = url;
      })
      .catch((error: unknown) => showError(error));
  };

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? onOpenChange(true) : close())}>
      <DialogContent closeLabel={t('drawn.close')} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('export.title', { name: subject })}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4" data-testid="export-dialog">
          {!exportId && request && (
            <div className="space-y-2">
              <label htmlFor="export-format" className="text-sm font-medium text-text">
                {t('export.format')}
              </label>
              <select
                id="export-format"
                className={selectClass}
                value={format}
                onChange={(event) => setFormat(event.target.value as GisExportFormat)}
              >
                {GIS_EXPORT_FORMATS.map((value) => (
                  <option key={value} value={value}>
                    {t(`export.formats.${value}`)}
                  </option>
                ))}
              </select>
              <p className="text-xs text-text-muted">{t('export.hint')}</p>
            </div>
          )}

          {running && (
            <div className="space-y-2" data-testid="export-progress">
              <p className="text-sm text-text">{t('export.running')}</p>
              <Skeleton className="h-2 w-full" />
            </div>
          )}

          {done && (
            <div className="space-y-2" data-testid="export-ready">
              <div className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="size-4" />
                {t('export.ready', {
                  count: record.data?.featureCount ?? 0,
                  size: formatBytes(record.data?.sizeBytes ?? 0),
                })}
              </div>
              <p className="truncate text-xs text-text-muted">{record.data?.fileName}</p>
            </div>
          )}

          {failed && (
            <div className="flex items-start gap-2 text-sm text-danger" data-testid="export-error">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span className="break-words">{record.data?.error ?? t('export.failed')}</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={close}>
            {done ? t('import.finish') : t('drawn.cancel')}
          </Button>
          {done ? (
            <Button onClick={download} data-testid="export-download">
              <Download className="size-4" />
              {t('export.download')}
            </Button>
          ) : (
            <Button onClick={submit} disabled={running} data-testid="export-submit">
              {t('export.start')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
