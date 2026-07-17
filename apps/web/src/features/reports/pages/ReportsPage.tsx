import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileBarChart, Lock, Play, Save, Trash2 } from 'lucide-react';
import {
  Button,
  ConfirmDialog,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  PageHeader,
  Skeleton,
  toast,
} from '@cuks/ui';
import type { SavedReportDto } from '@cuks/shared';
import { useCan } from '@/lib/ability';
import { ApiError } from '@/lib/api-client';
import { useIncidentMapFilterOptions } from '@/features/map/api/queries';
import { ReportControls } from '../components/ReportControls';
import { ReportTable } from '../components/ReportTable';
import {
  exportReport,
  useDeleteReport,
  useRunReport,
  useSaveReport,
  useSavedReports,
} from '../api/queries';
import {
  buildReportQuery,
  DEFAULT_REPORT_FORM,
  presetForm,
  PRESET_KEYS,
  queryToForm,
  type ReportFormState,
} from '../lib/report';

/**
 * «Конструктор отчётов» (docs/modules/10 §8, task 2.12): incident-registry filters
 * + grouping/metrics → a report table, with presets, XLSX export and saved reports.
 * Gated by `analytics.build`.
 */
export function ReportsPage(): React.JSX.Element {
  const { t } = useTranslation('reports');
  const canBuild = useCan('analytics.build');
  const [form, setForm] = useState<ReportFormState>(DEFAULT_REPORT_FORM);
  const [title, setTitle] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<SavedReportDto | null>(null);

  const run = useRunReport();
  const save = useSaveReport();
  const remove = useDeleteReport();
  const saved = useSavedReports();
  const options = useIncidentMapFilterOptions();

  useEffect(() => {
    document.title = t('title');
  }, [t]);

  const canRun = form.metrics.length > 0;
  const runForm = useMemo(() => form, [form]);

  if (!canBuild) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('title')} description={t('subtitle')} />
        <EmptyState icon={Lock} title={t('noAccessTitle')} description={t('noAccessDescription')} />
      </div>
    );
  }

  const runReport = (next: ReportFormState = runForm): void => {
    run.mutate(buildReportQuery(next));
  };

  const applyPreset = (key: (typeof PRESET_KEYS)[number]): void => {
    const preset = presetForm(key);
    setForm(preset);
    setTitle(t(`preset.${key}`));
    run.mutate(buildReportQuery(preset));
  };

  const doExport = async (): Promise<void> => {
    setExporting(true);
    try {
      await exportReport({
        ...buildReportQuery(form),
        ...(title.trim() ? { title: title.trim() } : {}),
      });
    } catch {
      toast({ title: t('exportFailed'), tone: 'danger' });
    } finally {
      setExporting(false);
    }
  };

  const submitSave = (name: string): void => {
    save.mutate(
      { name, query: buildReportQuery(form) },
      {
        onSuccess: () => {
          setSaveOpen(false);
          toast({ title: t('saved'), tone: 'success' });
        },
        onError: (error) =>
          toast({
            title: error instanceof ApiError ? error.message : t('saveFailed'),
            tone: 'danger',
          }),
      },
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => runReport()} disabled={!canRun || run.isPending}>
              <Play /> {t('run')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void doExport()}
              disabled={!canRun || exporting}
            >
              <Download /> {t('export')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSaveOpen(true)}
              disabled={!canRun}
            >
              <Save /> {t('save')}
            </Button>
          </div>
        }
      />

      {/* Presets + optional title */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-text-muted">{t('presets')}:</span>
        {PRESET_KEYS.map((key) => (
          <Button key={key} variant="secondary" size="sm" onClick={() => applyPreset(key)}>
            {t(`preset.${key}`)}
          </Button>
        ))}
        <Input
          className="ml-auto h-8 w-64"
          placeholder={t('titlePlaceholder')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
        />
      </div>

      <ReportControls form={form} onChange={setForm} options={options.data} />

      {/* Saved reports */}
      {saved.data && saved.data.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-text-muted">{t('savedReports')}:</span>
          {saved.data.map((report) => (
            <span
              key={report.id}
              className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface py-1 pl-2.5 pr-1 text-[13px]"
            >
              <button
                type="button"
                className="text-text hover:text-primary"
                onClick={() => {
                  const restored = queryToForm(report.query);
                  setForm(restored);
                  setTitle(report.name);
                  runReport(restored);
                }}
              >
                {report.name}
              </button>
              <button
                type="button"
                className="text-text-muted hover:text-danger"
                aria-label={t('deleteReport', { name: report.name })}
                onClick={() => setPendingDelete(report)}
              >
                <Trash2 className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {/* Results */}
      {run.isPending ? (
        <Skeleton className="h-64 w-full rounded-lg" />
      ) : run.isError ? (
        <div className="rounded-lg border border-border bg-surface p-10 text-center">
          <p className="text-sm text-danger">
            {run.error instanceof ApiError ? run.error.message : t('runFailed')}
          </p>
        </div>
      ) : run.data ? (
        run.data.rows.length === 0 ? (
          <EmptyState
            icon={FileBarChart}
            title={t('emptyTitle')}
            description={t('emptyDescription')}
          />
        ) : (
          <ReportTable result={run.data} />
        )
      ) : (
        <EmptyState
          icon={FileBarChart}
          title={t('startTitle')}
          description={t('startDescription')}
        />
      )}

      <SaveDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        defaultName={title}
        pending={save.isPending}
        onSubmit={submitSave}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title={t('deleteReportTitle')}
        description={t('deleteReportDescription')}
        {...(pendingDelete ? { entityName: pendingDelete.name } : {})}
        confirmLabel={t('deleteReportConfirm')}
        cancelLabel={t('cancel')}
        closeLabel={t('cancel')}
        loading={remove.isPending}
        destructive
        onConfirm={() => {
          if (!pendingDelete) return;
          remove.mutate(pendingDelete.id, {
            onSuccess: () => setPendingDelete(null),
          });
        }}
      />
    </div>
  );
}

function SaveDialog({
  open,
  onOpenChange,
  defaultName,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultName: string;
  pending: boolean;
  onSubmit: (name: string) => void;
}): React.JSX.Element {
  const { t } = useTranslation('reports');
  const [name, setName] = useState(defaultName);

  useEffect(() => {
    if (open) setName(defaultName);
  }, [open, defaultName]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t('cancel')} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('saveTitle')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) onSubmit(name.trim());
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="report-name">{t('reportName')}</Label>
            <Input
              id="report-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              required
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={!name.trim() || pending}>
              {t('save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
