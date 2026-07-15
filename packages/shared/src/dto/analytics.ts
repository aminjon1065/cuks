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

// --- «Статистика ЧС» (docs/modules/10 §8, task 2.11) ---

/**
 * Statistics dashboard filter: period + region + incident type (docs/modules/10
 * §8). Flat query params, matching the incident registry convention.
 */
export const analyticsStatsQuerySchema = z
  .object({
    from: isoDateTimeSchema,
    to: isoDateTimeSchema,
    regionId: z.string().uuid().optional(),
    typeCode: z.string().trim().min(1).max(120).optional(),
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
export type AnalyticsStatsQuery = z.infer<typeof analyticsStatsQuerySchema>;

/** Month bucket (label `YYYY-MM`, Asia/Dushanbe) with counts and casualty totals. */
export interface StatsByMonth {
  month: string;
  count: number;
  dead: number;
  injured: number;
  damage: string;
}

/** Incident count by type (name resolved server-side). */
export interface StatsByType {
  typeCode: string;
  typeName: string;
  count: number;
}

/**
 * Incident count by administrative unit. Region-level today (dev has only region
 * geometry); the same shape carries districts once their boundaries are imported.
 */
export interface StatsByRegion {
  regionId: string | null;
  regionName: string;
  count: number;
}

/** One day×hour heat cell. `dow` is ISO (1=Mon … 7=Sun), `hour` 0–23, both in
 *  Asia/Dushanbe. */
export interface StatsHeatCell {
  dow: number;
  hour: number;
  count: number;
}

/** Casualty and damage totals by incident type. */
export interface StatsCasualtiesByType {
  typeCode: string;
  typeName: string;
  dead: number;
  injured: number;
  evacuated: number;
  damage: string;
}

/** Overall totals for the filtered set. */
export interface StatsTotals {
  incidents: number;
  dead: number;
  injured: number;
  evacuated: number;
  damage: string;
}

export interface AnalyticsStatsDto {
  filters: { from: string; to: string; regionId: string | null; typeCode: string | null };
  totals: StatsTotals;
  byMonth: StatsByMonth[];
  byType: StatsByType[];
  byRegion: StatsByRegion[];
  heatmap: StatsHeatCell[];
  casualtiesByType: StatsCasualtiesByType[];
}

/** A region boundary for the ECharts choropleth. GeoJSON `FeatureCollection`;
 *  `properties.name` is the Russian name ECharts maps series values against. */
export interface RegionFeature {
  type: 'Feature';
  id: string;
  properties: { id: string; code: string; name: string };
  geometry: unknown;
}
export interface RegionFeatureCollection {
  type: 'FeatureCollection';
  features: RegionFeature[];
}
