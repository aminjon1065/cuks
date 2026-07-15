import {
  REPORT_METRICS,
  type IncidentStatus,
  type ReportDimension,
  type ReportMetric,
  type ReportQuery,
} from '@cuks/shared';

export const REPORT_PERIODS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

const PERIOD_DAYS: Record<ReportPeriod, number> = {
  day: 1,
  week: 7,
  month: 30,
  quarter: 90,
  year: 365,
};

/** The report-builder form (period + registry filters + grouping/metrics + АППГ). */
export interface ReportFormState {
  period: ReportPeriod;
  regionId: string;
  typeCode: string;
  severity: string;
  status: '' | IncidentStatus;
  groupBy: ReportDimension[];
  metrics: ReportMetric[];
  compareYoY: boolean;
}

export const DEFAULT_REPORT_FORM: ReportFormState = {
  period: 'month',
  regionId: '',
  typeCode: '',
  severity: '',
  status: '',
  groupBy: ['type'],
  metrics: ['count', 'dead', 'injured', 'damage'],
  compareYoY: false,
};

/** Turn the form into the API query — a rolling window from the period, dropping
 *  empty filters. */
export function buildReportQuery(form: ReportFormState, now: Date = new Date()): ReportQuery {
  const to = now;
  const from = new Date(to.getTime() - PERIOD_DAYS[form.period] * 86_400_000);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    ...(form.regionId ? { regionId: form.regionId } : {}),
    ...(form.typeCode ? { typeCode: form.typeCode } : {}),
    ...(form.severity ? { severity: Number(form.severity) } : {}),
    ...(form.status ? { status: form.status } : {}),
    groupBy: form.groupBy,
    metrics: form.metrics,
    ...(form.compareYoY ? { compareYoY: true } : {}),
  };
}

/** Restore a saved report definition into the form (period is best-effort from the
 *  saved window length). */
export function queryToForm(query: ReportQuery): ReportFormState {
  const days = Math.round(
    (new Date(query.to).getTime() - new Date(query.from).getTime()) / 86_400_000,
  );
  const period = (REPORT_PERIODS.find((p) => PERIOD_DAYS[p] === days) ?? 'month') as ReportPeriod;
  return {
    period,
    regionId: query.regionId ?? '',
    typeCode: query.typeCode ?? '',
    severity: query.severity ? String(query.severity) : '',
    status: query.status ?? '',
    groupBy: query.groupBy,
    metrics: query.metrics,
    compareYoY: query.compareYoY ?? false,
  };
}

export type PresetKey = 'daily' | 'byType' | 'yoy';
export const PRESET_KEYS: readonly PresetKey[] = ['daily', 'byType', 'yoy'];

/** The three preset reports (docs/modules/10 §8). */
export function presetForm(key: PresetKey): ReportFormState {
  switch (key) {
    case 'daily':
      return {
        ...DEFAULT_REPORT_FORM,
        period: 'day',
        groupBy: ['region'],
        metrics: [...REPORT_METRICS],
        compareYoY: false,
      };
    case 'byType':
      return {
        ...DEFAULT_REPORT_FORM,
        period: 'month',
        groupBy: ['type'],
        metrics: ['count', 'dead', 'injured', 'damage'],
        compareYoY: false,
      };
    case 'yoy':
      return {
        ...DEFAULT_REPORT_FORM,
        period: 'year',
        groupBy: ['month'],
        metrics: ['count', 'dead', 'damage'],
        compareYoY: true,
      };
  }
}
