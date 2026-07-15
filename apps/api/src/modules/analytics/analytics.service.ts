import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gte, isNull, lt, ne, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { adminUnits, dictionaries, incidentReports, incidents, type Database } from '@cuks/db';
import type {
  AnalyticsKpis,
  AnalyticsStatsDto,
  AnalyticsStatsQuery,
  AnalyticsSummaryDto,
  AnalyticsSummaryQuery,
  ActiveIncidentPoint,
  RegionFeatureCollection,
  SummaryReportItem,
} from '@cuks/shared';
import { DB } from '../../common/db/db.module';

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
  constructor(@Inject(DB) private readonly db: Database) {}

  async summary(query: AnalyticsSummaryQuery): Promise<AnalyticsSummaryDto> {
    const from = new Date(query.from);
    const to = new Date(query.to);
    // The previous window is the equal-length span immediately before `from`.
    const prevFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));

    const [kpis, activeIncidents, latestReports] = await Promise.all([
      this.kpis(prevFrom, from, to),
      this.activeIncidents(),
      this.latestReports(),
    ]);

    return { period: { from: query.from, to: query.to }, kpis, activeIncidents, latestReports };
  }

  /**
   * Both windows in a single scan over `[prevFrom, to)`: aggregate FILTERs split
   * the current window (`[from, to)`) from the previous one (`[prevFrom, from)`).
   * Counts and casualty sums come back as `int`; damage stays `numeric` (a string).
   */
  private async kpis(prevFrom: Date, from: Date, to: Date): Promise<AnalyticsKpis> {
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
  private async activeIncidents(): Promise<AnalyticsSummaryDto['activeIncidents']> {
    const openFilter = and(isNull(incidents.deletedAt), ne(incidents.status, 'closed'));
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

  private async latestReports(): Promise<SummaryReportItem[]> {
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
      .where(isNull(incidents.deletedAt))
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
  async stats(query: AnalyticsStatsQuery): Promise<AnalyticsStatsDto> {
    const where = and(...this.statsWhere(query));
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
}
