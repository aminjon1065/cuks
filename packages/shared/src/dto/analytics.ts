import { z } from 'zod';
import type { IncidentStatus } from '../enums/index';

const isoDateTimeSchema = z.string().datetime({ offset: true });

/**
 * «Оперативная сводка» summary window (docs/modules/10 §8, task 2.10). The client
 * derives the window from the period picker in Asia/Dushanbe and sends explicit
 * bounds, matching the incident registry's flat query-filter convention (docs/04
 * §REST). The previous window (for deltas) is the equal-length span immediately
 * before `from`, computed server-side.
 */
export const analyticsSummaryQuerySchema = z
  .object({
    from: isoDateTimeSchema,
    to: isoDateTimeSchema,
  })
  .superRefine((value, ctx) => {
    if (new Date(value.from) >= new Date(value.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: '`from` must be before `to`',
        path: ['from'],
      });
    }
  });
export type AnalyticsSummaryQuery = z.infer<typeof analyticsSummaryQuerySchema>;

/** A counted metric over the current window and the equal-length previous window,
 *  so the UI can render the period-over-period delta. */
export interface AnalyticsMetric {
  value: number;
  previous: number;
}

/** A summed money metric. Amounts are `numeric` strings end-to-end — never a JS
 *  float (CLAUDE.md §2). */
export interface AnalyticsMoneyMetric {
  value: string;
  previous: string;
}

/** The five KPI cards required by docs/modules/10 §8. */
export interface AnalyticsKpis {
  incidents: AnalyticsMetric;
  dead: AnalyticsMetric;
  injured: AnalyticsMetric;
  evacuated: AnalyticsMetric;
  damage: AnalyticsMoneyMetric;
}

/** An active (not-closed) incident as a point for the summary inset map. The
 *  coordinate is the geometry's centroid, so both point and polygon incidents
 *  resolve to a single marker. */
export interface ActiveIncidentPoint {
  id: string;
  number: string;
  severity: 1 | 2 | 3 | 4 | 5;
  status: IncidentStatus;
  longitude: number;
  latitude: number;
}

/** A latest-донесение row for the summary feed, joined to its incident. */
export interface SummaryReportItem {
  id: string;
  incidentId: string;
  incidentNumber: string;
  typeCode: string;
  severity: 1 | 2 | 3 | 4 | 5;
  status: IncidentStatus;
  reportedAt: string;
  text: string | null;
  dead: number | null;
  injured: number | null;
}

/**
 * Operational summary payload (`GET /analytics/summary`). `activeIncidents` is
 * capped for the inset; `truncated` + `total` make the cap explicit rather than
 * silently dropping points.
 */
export interface AnalyticsSummaryDto {
  period: { from: string; to: string };
  kpis: AnalyticsKpis;
  activeIncidents: {
    points: ActiveIncidentPoint[];
    total: number;
    truncated: boolean;
  };
  latestReports: SummaryReportItem[];
}
