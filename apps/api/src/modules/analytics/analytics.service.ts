import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, isNull, ne, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { incidentReports, incidents, type Database } from '@cuks/db';
import type {
  AnalyticsKpis,
  AnalyticsSummaryDto,
  AnalyticsSummaryQuery,
  ActiveIncidentPoint,
  SummaryReportItem,
} from '@cuks/shared';
import { DB } from '../../common/db/db.module';

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
    const sumMoney = (when: SQL) =>
      sql<string>`coalesce(sum(${incidents.damageEst}) filter (where ${when}), 0)::numeric(18, 2)`;

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
}
