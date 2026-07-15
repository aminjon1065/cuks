import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm';
import {
  adminUnits,
  dictionaries,
  incidentReports,
  incidents,
  savedFilters,
  type Database,
} from '@cuks/db';
import type {
  AnalyticsKpis,
  AnalyticsStatsDto,
  AnalyticsStatsQuery,
  AnalyticsSummaryDto,
  AnalyticsSummaryQuery,
  ActiveIncidentPoint,
  RegionFeatureCollection,
  ReportDimension,
  ReportExportInput,
  ReportMetric,
  ReportQuery,
  ReportResultDto,
  ReportRow,
  SavedReportDto,
  SaveReportInput,
  SummaryReportItem,
} from '@cuks/shared';
import { buildXlsx, type XlsxRow } from '@cuks/shared/office/xlsx';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB } from '../../common/db/db.module';
import { AppException } from '../../common/exceptions/app.exception';
import { ScopeService } from '../admin/scope.service';

/** Report definitions are saved on the shared `saved_filters` table under this module. */
const REPORT_MODULE = 'analytics';
/** The read permissions that gate the analytics endpoints; the territory scope is
 *  resolved against these so a role holding either one is confined to its region(s)
 *  rather than to nothing (task 2.13). */
const ANALYTICS_SCOPE_PERMISSIONS = ['analytics.view', 'analytics.build'] as const;
/** КЧС letterhead for exported report files. */
const ORG_NAME = 'Комитет по чрезвычайным ситуациям и гражданской обороне';
/** Russian column labels for the server-generated XLSX (the file is always ru). */
const DIMENSION_LABELS: Record<ReportDimension, string> = {
  type: 'Вид ЧС',
  region: 'Регион',
  month: 'Месяц',
};
const METRIC_LABELS: Record<ReportMetric, string> = {
  count: 'ЧС',
  dead: 'Погибшие',
  injured: 'Пострадавшие',
  evacuated: 'Эвакуированные',
  damage: 'Ущерб, сомони',
};

/** Time buckets (month, day-of-week, hour) are computed in the mandated display
 *  zone (CLAUDE.md §2) so they read as local operational time. Inlined as a SQL
 *  literal (not a bind param) so it stays identical between SELECT and GROUP BY. */
const LOCAL_TZ = sql.raw("at time zone 'Asia/Dushanbe'");

/** The inset map shows the most severe active incidents; the cap keeps the payload
 *  bounded and is surfaced (never silently truncated) via `truncated`/`total`. */
const ACTIVE_POINTS_LIMIT = 300;
/** The «лента последних донесений» shows a short, glanceable list. */
const LATEST_REPORTS_LIMIT = 8;

/**
 * «Оперативная сводка» analytics (docs/modules/10 §8, task 2.10). Read-only
 * aggregates over `app.incidents`/`app.incident_reports` for the operational
 * dashboard: KPIs with a period-over-period delta, the active-incident points for
 * the inset map, and the newest situation reports.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly scope: ScopeService,
  ) {}

  /** Territory data-scope for aggregates: a regional user's charts/reports cover
   *  only their region(s); central/superadmin see all (task 2.13). Resolved against
   *  the analytics permissions that gate these endpoints — not `gis.view`, which an
   *  analytics-only role need not hold (that would collapse the scope to match-nothing). */
  private async regionScope(user: AuthUser): Promise<SQL | undefined> {
    const scope = await this.scope.getAccessibleRegions(user, ANALYTICS_SCOPE_PERMISSIONS);
    if (scope.global) return undefined;
    return or(
      inArray(incidents.regionId, scope.adminUnitIds),
      inArray(incidents.districtId, scope.adminUnitIds),
      inArray(incidents.jamoatId, scope.adminUnitIds),
    );
  }

  async summary(query: AnalyticsSummaryQuery, user: AuthUser): Promise<AnalyticsSummaryDto> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    // The previous window is the equal-length span immediately before `from`.
    const prevFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));
    const scope = await this.regionScope(user);

    const [kpis, activeIncidents, latestReports] = await Promise.all([
      this.kpis(prevFrom, from, to, scope),
      this.activeIncidents(scope),
      this.latestReports(scope),
    ]);

    return { period: { from: query.from, to: query.to }, kpis, activeIncidents, latestReports };
  }

  /**
   * Both windows in a single scan over `[prevFrom, to)`: aggregate FILTERs split
   * the current window (`[from, to)`) from the previous one (`[prevFrom, from)`).
   * Counts and casualty sums come back as `int`; damage stays `numeric` (a string).
   */
  private async kpis(prevFrom: Date, from: Date, to: Date, scope?: SQL): Promise<AnalyticsKpis> {
    const inCurrent: SQL = sql`${incidents.occurredAt} >= ${from} and ${incidents.occurredAt} < ${to}`;
    const inPrevious: SQL = sql`${incidents.occurredAt} >= ${prevFrom} and ${incidents.occurredAt} < ${from}`;
    const sumInt = (col: AnyColumn, when: SQL) =>
      sql<number>`coalesce(sum(${col}) filter (where ${when}), 0)::int`;
    // `round(..., 2)::text` avoids re-capping the SUM to the column's precision
    // (sum() is unbounded numeric), which would overflow on very large totals.
    const sumMoney = (when: SQL) =>
      sql<string>`round(coalesce(sum(${incidents.damageEst}) filter (where ${when}), 0), 2)::text`;

    const [row] = await this.db
      .select({
        incidents: sql<number>`count(*) filter (where ${inCurrent})::int`,
        incidentsPrev: sql<number>`count(*) filter (where ${inPrevious})::int`,
        dead: sumInt(incidents.dead, inCurrent),
        deadPrev: sumInt(incidents.dead, inPrevious),
        injured: sumInt(incidents.injured, inCurrent),
        injuredPrev: sumInt(incidents.injured, inPrevious),
        evacuated: sumInt(incidents.evacuated, inCurrent),
        evacuatedPrev: sumInt(incidents.evacuated, inPrevious),
        damage: sumMoney(inCurrent),
        damagePrev: sumMoney(inPrevious),
      })
      .from(incidents)
      .where(
        and(
          isNull(incidents.deletedAt),
          sql`${incidents.occurredAt} >= ${prevFrom}`,
          sql`${incidents.occurredAt} < ${to}`,
          ...(scope ? [scope] : []),
        ),
      );

    const r = row!;
    return {
      incidents: { value: r.incidents, previous: r.incidentsPrev },
      dead: { value: r.dead, previous: r.deadPrev },
      injured: { value: r.injured, previous: r.injuredPrev },
      evacuated: { value: r.evacuated, previous: r.evacuatedPrev },
      damage: { value: r.damage, previous: r.damagePrev },
    };
  }

  /** Active = not closed, period-independent (the current operational picture).
   *  Centroid resolves both point and polygon incidents to one marker. */
  private async activeIncidents(scope?: SQL): Promise<AnalyticsSummaryDto['activeIncidents']> {
    const openFilter = and(
      isNull(incidents.deletedAt),
      ne(incidents.status, 'closed'),
      ...(scope ? [scope] : []),
    );
    const rows = await this.db
      .select({
        id: incidents.id,
        number: incidents.number,
        severity: incidents.severity,
        status: incidents.status,
        longitude: sql<number>`ST_X(ST_Centroid(${incidents.geom}))`,
        latitude: sql<number>`ST_Y(ST_Centroid(${incidents.geom}))`,
      })
      .from(incidents)
      .where(openFilter)
      .orderBy(desc(incidents.severity), desc(incidents.occurredAt))
      .limit(ACTIVE_POINTS_LIMIT + 1);

    const truncated = rows.length > ACTIVE_POINTS_LIMIT;
    const points: ActiveIncidentPoint[] = (
      truncated ? rows.slice(0, ACTIVE_POINTS_LIMIT) : rows
    ).map((row) => ({
      id: row.id,
      number: row.number,
      // DB check constraint pins severity to 1..5 (docs/modules/10 §3).
      severity: row.severity as ActiveIncidentPoint['severity'],
      status: row.status,
      longitude: row.longitude,
      latitude: row.latitude,
    }));

    let total = points.length;
    if (truncated) {
      const [counted] = await this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(incidents)
        .where(openFilter);
      total = counted!.total;
    }
    return { points, total, truncated };
  }

  private async latestReports(scope?: SQL): Promise<SummaryReportItem[]> {
    const rows = await this.db
      .select({
        id: incidentReports.id,
        incidentId: incidentReports.incidentId,
        reportedAt: incidentReports.reportedAt,
        text: incidentReports.text,
        dead: incidentReports.dead,
        injured: incidentReports.injured,
        incidentNumber: incidents.number,
        typeCode: incidents.typeCode,
        severity: incidents.severity,
        status: incidents.status,
      })
      .from(incidentReports)
      .innerJoin(incidents, eq(incidents.id, incidentReports.incidentId))
      .where(and(isNull(incidents.deletedAt), ...(scope ? [scope] : [])))
      .orderBy(desc(incidentReports.reportedAt))
      .limit(LATEST_REPORTS_LIMIT);

    return rows.map((row) => ({
      id: row.id,
      incidentId: row.incidentId,
      incidentNumber: row.incidentNumber,
      typeCode: row.typeCode,
      severity: row.severity as SummaryReportItem['severity'],
      status: row.status,
      reportedAt: row.reportedAt.toISOString(),
      text: row.text,
      dead: row.dead,
      injured: row.injured,
    }));
  }

  // --- «Статистика ЧС» (docs/modules/10 §8, task 2.11) ---

  /**
   * Aggregates for the statistics dashboard, over the filtered incident set. Six
   * independent grouped queries run concurrently; time buckets (month, day-of-week,
   * hour) are computed in Asia/Dushanbe so they read as local operational time.
   */
  async stats(query: AnalyticsStatsQuery, user: AuthUser): Promise<AnalyticsStatsDto> {
    const scope = await this.regionScope(user);
    const where = and(...this.statsWhere(query), ...(scope ? [scope] : []));
    const monthLocal = sql`date_trunc('month', ${incidents.occurredAt} ${LOCAL_TZ})`;
    const dowLocal = sql<number>`extract(isodow from ${incidents.occurredAt} ${LOCAL_TZ})::int`;
    const hourLocal = sql<number>`extract(hour from ${incidents.occurredAt} ${LOCAL_TZ})::int`;
    const typeName = sql<string>`coalesce(${dictionaries.nameRu}, ${incidents.typeCode})`;
    const typeJoin = and(
      eq(dictionaries.type, 'incident_type'),
      eq(dictionaries.code, incidents.typeCode),
    );
    const sumInt = (col: AnyColumn) => sql<number>`coalesce(sum(${col}), 0)::int`;
    // `round(..., 2)::text` keeps two decimals without re-capping the SUM to the
    // column's own precision — sum() is unbounded numeric, so a `::numeric(18,2)`
    // cast would overflow on very large totals.
    const sumMoney = sql<string>`round(coalesce(sum(${incidents.damageEst}), 0), 2)::text`;

    const [totalsRow, byMonth, byType, byRegion, heatmap, casualtiesByType] = await Promise.all([
      this.db
        .select({
          incidents: sql<number>`count(*)::int`,
          dead: sumInt(incidents.dead),
          injured: sumInt(incidents.injured),
          evacuated: sumInt(incidents.evacuated),
          damage: sumMoney,
        })
        .from(incidents)
        .where(where),
      this.db
        .select({
          month: sql<string>`to_char(${monthLocal}, 'YYYY-MM')`,
          count: sql<number>`count(*)::int`,
          dead: sumInt(incidents.dead),
          injured: sumInt(incidents.injured),
          damage: sumMoney,
        })
        .from(incidents)
        .where(where)
        .groupBy(monthLocal)
        .orderBy(monthLocal),
      this.db
        .select({ typeCode: incidents.typeCode, typeName, count: sql<number>`count(*)::int` })
        .from(incidents)
        .leftJoin(dictionaries, typeJoin)
        .where(where)
        .groupBy(incidents.typeCode, dictionaries.nameRu)
        .orderBy(desc(sql`count(*)`)),
      this.db
        .select({
          regionId: incidents.regionId,
          regionName: sql<string>`coalesce(${adminUnits.nameRu}, '—')`,
          count: sql<number>`count(*)::int`,
        })
        .from(incidents)
        .leftJoin(adminUnits, eq(adminUnits.id, incidents.regionId))
        .where(where)
        .groupBy(incidents.regionId, adminUnits.nameRu)
        .orderBy(desc(sql`count(*)`)),
      this.db
        .select({ dow: dowLocal, hour: hourLocal, count: sql<number>`count(*)::int` })
        .from(incidents)
        .where(where)
        .groupBy(dowLocal, hourLocal),
      this.db
        .select({
          typeCode: incidents.typeCode,
          typeName,
          dead: sumInt(incidents.dead),
          injured: sumInt(incidents.injured),
          evacuated: sumInt(incidents.evacuated),
          damage: sumMoney,
        })
        .from(incidents)
        .leftJoin(dictionaries, typeJoin)
        .where(where)
        .groupBy(incidents.typeCode, dictionaries.nameRu)
        .orderBy(
          desc(sql`coalesce(sum(${incidents.dead}), 0) + coalesce(sum(${incidents.injured}), 0)`),
        ),
    ]);

    return {
      filters: {
        from: query.from,
        to: query.to,
        regionId: query.regionId ?? null,
        typeCode: query.typeCode ?? null,
      },
      totals: totalsRow[0]!,
      byMonth,
      byType,
      byRegion,
      heatmap,
      casualtiesByType,
    };
  }

  /** Region boundaries as a GeoJSON `FeatureCollection` for the ECharts choropleth.
   *  Geometry is simplified to keep the payload small (the inset is low-detail). */
  async regionsGeoJson(): Promise<RegionFeatureCollection> {
    const rows = await this.db
      .select({
        id: adminUnits.id,
        code: adminUnits.code,
        name: adminUnits.nameRu,
        geojson: sql<string>`ST_AsGeoJSON(ST_SimplifyPreserveTopology(${adminUnits.geom}, 0.005))`,
      })
      .from(adminUnits)
      .where(eq(adminUnits.level, 'region'))
      .orderBy(adminUnits.code);

    return {
      type: 'FeatureCollection',
      features: rows.map((row) => ({
        type: 'Feature',
        id: row.id,
        properties: { id: row.id, code: row.code, name: row.name },
        geometry: JSON.parse(row.geojson) as unknown,
      })),
    };
  }

  private statsWhere(query: AnalyticsStatsQuery): SQL[] {
    const where: SQL[] = [
      isNull(incidents.deletedAt),
      gte(incidents.occurredAt, new Date(query.from)),
      lt(incidents.occurredAt, new Date(query.to)),
    ];
    if (query.regionId) where.push(eq(incidents.regionId, query.regionId));
    if (query.typeCode) where.push(eq(incidents.typeCode, query.typeCode));
    return where;
  }

  // --- Конструктор отчётов (docs/modules/10 §8, task 2.12) ---

  /**
   * Aggregate incidents by the chosen dimensions and metrics (`POST /analytics/query`).
   * With `compareYoY` the same aggregation runs on the same period a year earlier and
   * the two are merged by dimension key («АППГ»).
   */
  async query(input: ReportQuery, user: AuthUser): Promise<ReportResultDto> {
    const dimensions = dedupeDimensions(input.groupBy);
    const from = new Date(input.from);
    const to = new Date(input.to);
    const scope = await this.regionScope(user);

    const current = await this.runReport(input, dimensions, from, to, scope);
    if (!input.compareYoY) {
      return {
        dimensions,
        metrics: input.metrics,
        compareYoY: false,
        rows: current.rows,
        totals: { values: current.totals },
      };
    }

    const prev = await this.runReport(
      input,
      dimensions,
      shiftYears(from, -1),
      shiftYears(to, -1),
      scope,
    );
    // The `month` dimension key carries an absolute year (`YYYY-MM`), so the prior
    // window's months would never match the current ones. Shift the prev key's month
    // component forward a year so last year's 2025-07 aligns with this year's 2026-07.
    const monthIndex = dimensions.indexOf('month');
    const alignPrevKeys = (keys: string[]): string[] =>
      monthIndex < 0
        ? keys
        : keys.map((key, i) => (i === monthIndex ? shiftMonthKeyYear(key, 1) : key));

    const prevByKey = new Map(
      prev.rows.map((row) => [joinKeys(alignPrevKeys(row.keys)), row.values]),
    );
    const seen = new Set<string>();
    const rows: ReportRow[] = current.rows.map((row) => {
      const key = joinKeys(row.keys);
      seen.add(key);
      return {
        keys: row.keys,
        values: row.values,
        valuesPrev: prevByKey.get(key) ?? zeroMetrics(input.metrics),
      };
    });
    // Groups present a year ago but not now still belong in an АППГ comparison, shown
    // under the current-year label they correspond to.
    for (const row of prev.rows) {
      const alignedKeys = alignPrevKeys(row.keys);
      if (!seen.has(joinKeys(alignedKeys))) {
        rows.push({
          keys: alignedKeys,
          values: zeroMetrics(input.metrics),
          valuesPrev: row.values,
        });
      }
    }
    return {
      dimensions,
      metrics: input.metrics,
      compareYoY: true,
      rows,
      totals: { values: current.totals, valuesPrev: prev.totals },
    };
  }

  /** The report as an XLSX buffer with a КЧС letterhead (`POST /analytics/query/export`). */
  async exportReport(input: ReportExportInput, user: AuthUser): Promise<Buffer> {
    const result = await this.query(input, user);
    const dims = result.dimensions;
    const metrics = result.metrics;

    const header: XlsxRow = [
      ...dims.map((d) => DIMENSION_LABELS[d]),
      ...metrics.map((m) => METRIC_LABELS[m]),
      ...(result.compareYoY ? metrics.map((m) => `${METRIC_LABELS[m]} (АППГ)`) : []),
    ];
    const rows: XlsxRow[] = [
      [ORG_NAME],
      ...(input.title ? [[input.title] as XlsxRow] : []),
      [`Период: ${input.from.slice(0, 10)} — ${input.to.slice(0, 10)}`],
      [],
      header,
      ...result.rows.map((row) => [
        ...row.keys,
        ...row.values,
        ...(result.compareYoY ? (row.valuesPrev ?? []) : []),
      ]),
    ];
    // A totals line only when grouped — «Итого» under the first dimension, blanks
    // under the rest so the metric values stay under their headers. With no grouping
    // the single data row already IS the grand total, so no extra line is added.
    if (dims.length > 0) {
      rows.push([
        'Итого',
        ...dims.slice(1).map(() => ''),
        ...result.totals.values,
        ...(result.compareYoY ? (result.totals.valuesPrev ?? []) : []),
      ]);
    }

    return Buffer.from(buildXlsx(rows, 'Отчёт'));
  }

  async listReports(userId: string): Promise<SavedReportDto[]> {
    const rows = await this.db
      .select()
      .from(savedFilters)
      .where(
        and(
          eq(savedFilters.userId, userId),
          eq(savedFilters.module, REPORT_MODULE),
          isNull(savedFilters.deletedAt),
        ),
      )
      .orderBy(desc(savedFilters.createdAt));
    return rows.map(toSavedReport);
  }

  async saveReport(userId: string, input: SaveReportInput): Promise<SavedReportDto> {
    const [row] = await this.db
      .insert(savedFilters)
      .values({ userId, module: REPORT_MODULE, name: input.name, params: input.query })
      .returning();
    return toSavedReport(row!);
  }

  async removeReport(userId: string, id: string): Promise<void> {
    const [row] = await this.db
      .update(savedFilters)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(savedFilters.id, id),
          eq(savedFilters.userId, userId),
          eq(savedFilters.module, REPORT_MODULE),
          isNull(savedFilters.deletedAt),
        ),
      )
      .returning({ id: savedFilters.id });
    if (!row) throw AppException.notFound('analytics.report.not_found', 'Report not found');
  }

  /** One aggregation pass over a window: grouped rows + grand totals. */
  private async runReport(
    input: ReportQuery,
    dimensions: ReportDimension[],
    from: Date,
    to: Date,
    scope?: SQL,
  ): Promise<{ rows: ReportRow[]; totals: (number | string)[] }> {
    const where = and(...this.reportWhere(input, from, to), ...(scope ? [scope] : []));
    const selection: Record<string, SQL> = {};
    const groupExprs: SQL[] = [];
    dimensions.forEach((dim, i) => {
      const expr = dimensionExpr(dim);
      selection[`d${i}`] = expr;
      groupExprs.push(expr);
    });
    input.metrics.forEach((metric, i) => {
      selection[`m${i}`] = metricExpr(metric);
    });

    let builder = this.db.select(selection).from(incidents).$dynamic();
    if (dimensions.includes('type')) {
      builder = builder.leftJoin(
        dictionaries,
        and(eq(dictionaries.type, 'incident_type'), eq(dictionaries.code, incidents.typeCode)),
      );
    }
    if (dimensions.includes('region')) {
      builder = builder.leftJoin(adminUnits, eq(adminUnits.id, incidents.regionId));
    }
    builder = builder.where(where);
    if (groupExprs.length > 0) builder = builder.groupBy(...groupExprs).orderBy(...groupExprs);
    const raw = (await builder) as Record<string, number | string>[];

    const rows: ReportRow[] = raw.map((r) => ({
      keys: dimensions.map((_, i) => String(r[`d${i}`])),
      values: input.metrics.map((_, i) => r[`m${i}`]!),
    }));

    // Grand totals: the same metrics with no grouping (and so no joins).
    const totalsSelection: Record<string, SQL> = {};
    input.metrics.forEach((metric, i) => {
      totalsSelection[`m${i}`] = metricExpr(metric);
    });
    const [totalsRow] = (await this.db
      .select(totalsSelection)
      .from(incidents)
      .where(where)) as Record<string, number | string>[];
    const totals = input.metrics.map((_, i) => totalsRow![`m${i}`]!);

    return { rows, totals };
  }

  private reportWhere(input: ReportQuery, from: Date, to: Date): SQL[] {
    const where: SQL[] = [
      isNull(incidents.deletedAt),
      gte(incidents.occurredAt, from),
      lt(incidents.occurredAt, to),
    ];
    if (input.regionId) where.push(eq(incidents.regionId, input.regionId));
    if (input.typeCode) where.push(eq(incidents.typeCode, input.typeCode));
    if (input.severity) where.push(eq(incidents.severity, input.severity));
    if (input.status) where.push(eq(incidents.status, input.status));
    return where;
  }
}

/** SELECT/GROUP-BY expression for a report dimension (its resolved display value). */
function dimensionExpr(dimension: ReportDimension): SQL {
  switch (dimension) {
    case 'type':
      return sql`coalesce(${dictionaries.nameRu}, ${incidents.typeCode})`;
    case 'region':
      return sql`coalesce(${adminUnits.nameRu}, '—')`;
    case 'month':
      return sql`to_char(date_trunc('month', ${incidents.occurredAt} ${LOCAL_TZ}), 'YYYY-MM')`;
  }
}

/** Aggregate expression for a report metric (int counts/casualties, string money). */
function metricExpr(metric: ReportMetric): SQL {
  switch (metric) {
    case 'count':
      return sql<number>`count(*)::int`;
    case 'dead':
      return sql<number>`coalesce(sum(${incidents.dead}), 0)::int`;
    case 'injured':
      return sql<number>`coalesce(sum(${incidents.injured}), 0)::int`;
    case 'evacuated':
      return sql<number>`coalesce(sum(${incidents.evacuated}), 0)::int`;
    case 'damage':
      return sql<string>`round(coalesce(sum(${incidents.damageEst}), 0), 2)::text`;
  }
}

/** Preserve order, drop duplicate dimensions. */
function dedupeDimensions(dimensions: ReportDimension[]): ReportDimension[] {
  return [...new Set(dimensions)];
}

/** Zero values matching the metric list (money as a numeric string). */
function zeroMetrics(metrics: ReportMetric[]): (number | string)[] {
  return metrics.map((metric) => (metric === 'damage' ? '0.00' : 0));
}

const KEY_SEP = '\u241f';

/** Join dimension keys with a separator that cannot appear in a name. */
function joinKeys(keys: string[]): string {
  return keys.join(KEY_SEP);
}

/** Shift a `YYYY-MM` month key by whole years (for the АППГ alignment). */
function shiftMonthKeyYear(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-');
  return `${Number(year) + delta}-${month}`;
}

/** Shift an instant by whole years (for the same-period-last-year comparison). */
function shiftYears(date: Date, delta: number): Date {
  const shifted = new Date(date);
  shifted.setUTCFullYear(shifted.getUTCFullYear() + delta);
  return shifted;
}

function toSavedReport(row: typeof savedFilters.$inferSelect): SavedReportDto {
  return {
    id: row.id,
    name: row.name,
    query: row.params as ReportQuery,
    createdAt: row.createdAt.toISOString(),
  };
}
