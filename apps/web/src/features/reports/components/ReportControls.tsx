import { useTranslation } from 'react-i18next';
import { Checkbox, cn, Label, Switch } from '@cuks/ui';
import {
  INCIDENT_STATUSES,
  REPORT_DIMENSIONS,
  REPORT_METRICS,
  type IncidentMapFilterOptionsResponse,
  type ReportDimension,
  type ReportMetric,
} from '@cuks/shared';
import { REPORT_PERIODS, type ReportFormState } from '../lib/report';

const selectClass = cn(
  'h-9 w-full rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

const SEVERITIES = [1, 2, 3, 4, 5] as const;

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((value) => value !== item) : [...list, item];
}

/** The report-builder controls: period + registry filters + grouping/metrics + АППГ. */
export function ReportControls({
  form,
  onChange,
  options,
}: {
  form: ReportFormState;
  onChange: (next: ReportFormState) => void;
  options: IncidentMapFilterOptionsResponse | undefined;
}): React.JSX.Element {
  const { t } = useTranslation('reports');
  const { t: ti } = useTranslation('incidents');

  return (
    <div className="space-y-5 rounded-lg border border-border bg-surface p-5">
      {/* Filters */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label={t('filter.period')}>
          <select
            className={selectClass}
            value={form.period}
            onChange={(e) =>
              onChange({ ...form, period: e.target.value as ReportFormState['period'] })
            }
          >
            {REPORT_PERIODS.map((period) => (
              <option key={period} value={period}>
                {t(`period.${period}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('filter.region')}>
          <select
            className={selectClass}
            value={form.regionId}
            onChange={(e) => onChange({ ...form, regionId: e.target.value })}
          >
            <option value="">{t('filter.allRegions')}</option>
            {options?.regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.nameRu}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('filter.type')}>
          <select
            className={selectClass}
            value={form.typeCode}
            onChange={(e) => onChange({ ...form, typeCode: e.target.value })}
          >
            <option value="">{t('filter.allTypes')}</option>
            {options?.types.map((type) => (
              <option key={type.code} value={type.code}>
                {type.parentNameRu ? `${type.parentNameRu} · ${type.nameRu}` : type.nameRu}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('filter.severity')}>
          <select
            className={selectClass}
            value={form.severity}
            onChange={(e) => onChange({ ...form, severity: e.target.value })}
          >
            <option value="">{t('filter.allSeverities')}</option>
            {SEVERITIES.map((level) => (
              <option key={level} value={String(level)}>
                {ti(`severity.${level}`)}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t('filter.status')}>
          <select
            className={selectClass}
            value={form.status}
            onChange={(e) =>
              onChange({ ...form, status: e.target.value as ReportFormState['status'] })
            }
          >
            <option value="">{t('filter.allStatuses')}</option>
            {INCIDENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {ti(`status.${status}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {/* Grouping + metrics */}
      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
            {t('groupingLabel')}
          </div>
          <div className="flex flex-wrap gap-4">
            {REPORT_DIMENSIONS.map((dim) => (
              <CheckRow
                key={dim}
                label={t(`dimension.${dim}`)}
                checked={form.groupBy.includes(dim)}
                onChange={() =>
                  onChange({ ...form, groupBy: toggle(form.groupBy, dim as ReportDimension) })
                }
              />
            ))}
          </div>
        </div>
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
            {t('metricsLabel')}
          </div>
          <div className="flex flex-wrap gap-4">
            {REPORT_METRICS.map((metric) => (
              <CheckRow
                key={metric}
                label={t(`metric.${metric}`)}
                checked={form.metrics.includes(metric)}
                onChange={() =>
                  onChange({ ...form, metrics: toggle(form.metrics, metric as ReportMetric) })
                }
              />
            ))}
          </div>
        </div>
      </div>

      {/* АППГ */}
      <label className="flex items-center gap-2 text-[13px] text-text">
        <Switch
          checked={form.compareYoY}
          onCheckedChange={(v) => onChange({ ...form, compareYoY: v })}
        />
        {t('compareYoY')}
      </label>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-text-muted">{label}</Label>
      {children}
    </div>
  );
}

function CheckRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-text">
      <Checkbox checked={checked} onCheckedChange={onChange} />
      {label}
    </label>
  );
}
