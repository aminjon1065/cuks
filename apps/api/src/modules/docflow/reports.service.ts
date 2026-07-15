import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { orgUnits, positions, resolutions, userPositions, users, type Database } from '@cuks/db';
import { buildXlsx, type XlsxRow } from '@cuks/shared/office/xlsx';
import {
  type DisciplineGroupDto,
  type DisciplineReportDto,
  type DisciplineReportQuery,
  type DisciplineRowDto,
  type DisciplineTotals,
} from '@cuks/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB } from '../../common/db/db.module';
import { AppException } from '../../common/exceptions/app.exception';

/** КЧС letterhead for the exported report (the file is always ru, like the analytics export). */
const ORG_NAME = 'Комитет по чрезвычайным ситуациям и гражданской обороне';
const REPORT_TITLE = 'Отчёт исполнительской дисциплины';
/** Executors with no primary position land here (also the XLSX label for that group). */
const NO_SUBDIVISION = 'Без подразделения';

/** One executor's aggregated buckets straight from SQL (before the derived percentage). */
interface ExecutorAggregate {
  executorId: string;
  executorName: string;
  orgUnitId: string | null;
  orgUnitName: string | null;
  onTime: number;
  late: number;
  notDone: number;
}

/** discipline % = onTime / total, whole percent; null when nothing was due. */
function withPercent(b: { onTime: number; late: number; notDone: number }): DisciplineTotals {
  const total = b.onTime + b.late + b.notDone;
  return {
    total,
    onTime: b.onTime,
    late: b.late,
    notDone: b.notDone,
    disciplinePct: total > 0 ? Math.round((b.onTime / total) * 100) : null,
  };
}

function sumBuckets(items: readonly { onTime: number; late: number; notDone: number }[]): {
  onTime: number;
  late: number;
  notDone: number;
} {
  return items.reduce(
    (acc, i) => ({
      onTime: acc.onTime + i.onTime,
      late: acc.late + i.late,
      notDone: acc.notDone + i.notDone,
    }),
    { onTime: 0, late: 0, notDone: 0 },
  );
}

/**
 * Executive-discipline report (docs/modules/11 §5, task 3.9). Counts resolutions whose
 * `due_date` falls in the period, grouped by executor and their primary-position subdivision:
 * on time (done ≤ due), late (done > due), not done (still active); cancelled instructions are
 * excluded. The report exposes counts only (no document subjects), so no per-row ДСП visibility
 * gate is needed — the `docflow.reports.view` permission is the gate. An optional `orgUnitId`
 * narrows to that subdivision and its subtree.
 */
@Injectable()
export class ReportsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async discipline(query: DisciplineReportQuery, _actor: AuthUser): Promise<DisciplineReportDto> {
    const from = new Date(query.from);
    const to = new Date(query.to);

    const subtree = query.orgUnitId ? await this.subtreeFilter(query.orgUnitId) : undefined;

    const aggregates = (await this.db
      .select({
        executorId: resolutions.executorId,
        executorName: users.shortName,
        orgUnitId: orgUnits.id,
        orgUnitName: orgUnits.name,
        onTime: sql<number>`count(*) filter (where ${resolutions.status} = 'done' and ${resolutions.doneAt} <= ${resolutions.dueDate})::int`,
        late: sql<number>`count(*) filter (where ${resolutions.status} = 'done' and ${resolutions.doneAt} > ${resolutions.dueDate})::int`,
        notDone: sql<number>`count(*) filter (where ${resolutions.status} = 'active')::int`,
      })
      .from(resolutions)
      .innerJoin(users, eq(users.id, resolutions.executorId))
      .leftJoin(
        userPositions,
        and(eq(userPositions.userId, resolutions.executorId), eq(userPositions.isPrimary, true)),
      )
      .leftJoin(positions, eq(positions.id, userPositions.positionId))
      .leftJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId))
      .where(
        and(
          gte(resolutions.dueDate, from),
          lte(resolutions.dueDate, to),
          ne(resolutions.status, 'cancelled'),
          subtree,
        ),
      )
      .groupBy(
        resolutions.executorId,
        users.shortName,
        orgUnits.id,
        orgUnits.name,
      )) as ExecutorAggregate[];

    return {
      from: query.from,
      to: query.to,
      groups: this.groupBySubdivision(aggregates),
      totals: withPercent(sumBuckets(aggregates)),
    };
  }

  /** The report as an XLSX buffer with a КЧС letterhead (`GET .../discipline/export`). */
  async disciplineXlsx(query: DisciplineReportQuery, actor: AuthUser): Promise<Buffer> {
    const report = await this.discipline(query, actor);

    const header: XlsxRow = [
      'Подразделение',
      'Исполнитель',
      'Всего',
      'В срок',
      'С просрочкой',
      'Не исполнено',
      'Дисциплина, %',
    ];
    const rows: XlsxRow[] = [
      [ORG_NAME],
      [REPORT_TITLE],
      [`Период: ${query.from.slice(0, 10)} — ${query.to.slice(0, 10)}`],
      [],
      header,
    ];
    for (const group of report.groups) {
      for (const row of group.rows) {
        rows.push([
          group.orgUnitName,
          row.executorName,
          row.total,
          row.onTime,
          row.late,
          row.notDone,
          row.disciplinePct ?? '—',
        ]);
      }
      rows.push([
        `${group.orgUnitName} — итого`,
        '',
        group.total,
        group.onTime,
        group.late,
        group.notDone,
        group.disciplinePct ?? '—',
      ]);
    }
    rows.push([
      'Итого',
      '',
      report.totals.total,
      report.totals.onTime,
      report.totals.late,
      report.totals.notDone,
      report.totals.disciplinePct ?? '—',
    ]);

    return Buffer.from(buildXlsx(rows, 'Дисциплина'));
  }

  /** Group aggregates by subdivision, sort executors and groups by name, and derive totals.
   *  The «Без подразделения» group (null org unit) sorts last. */
  private groupBySubdivision(aggregates: readonly ExecutorAggregate[]): DisciplineGroupDto[] {
    const byUnit = new Map<string, { name: string; rows: DisciplineRowDto[] }>();
    for (const a of aggregates) {
      const key = a.orgUnitId ?? '';
      let group = byUnit.get(key);
      if (!group) {
        group = {
          name: a.orgUnitId ? (a.orgUnitName ?? NO_SUBDIVISION) : NO_SUBDIVISION,
          rows: [],
        };
        byUnit.set(key, group);
      }
      group.rows.push({
        executorId: a.executorId,
        executorName: a.executorName,
        ...withPercent(a),
      });
    }

    const groups: DisciplineGroupDto[] = [];
    for (const [key, group] of byUnit) {
      group.rows.sort((x, y) => x.executorName.localeCompare(y.executorName, 'ru'));
      groups.push({
        orgUnitId: key || null,
        orgUnitName: group.name,
        rows: group.rows,
        ...withPercent(sumBuckets(group.rows)),
      });
    }
    groups.sort((x, y) => {
      if (x.orgUnitId === null) return 1;
      if (y.orgUnitId === null) return -1;
      return x.orgUnitName.localeCompare(y.orgUnitName, 'ru');
    });
    return groups;
  }

  /** A predicate restricting org units to `orgUnitId` and its subtree via the materialized path
   *  (path segments are UUIDs joined by '.', so a `path || '.%'` prefix cannot collide). */
  private async subtreeFilter(orgUnitId: string) {
    const [unit] = await this.db
      .select({ path: orgUnits.path })
      .from(orgUnits)
      .where(and(eq(orgUnits.id, orgUnitId), isNull(orgUnits.deletedAt)))
      .limit(1);
    if (!unit) throw AppException.notFound('docflow.org_unit.not_found', 'Org unit not found');
    return or(eq(orgUnits.id, orgUnitId), sql`${orgUnits.path} like ${`${unit.path}.%`}`);
  }
}
