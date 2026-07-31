import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, isNull, lte, ne, or, sql } from 'drizzle-orm';
import { orgUnits, positions, resolutions, userPositions, users, type Database } from '@cuks/db';
import { buildXlsx, type XlsxRow } from '@cuks/shared/office/xlsx';
import {
  type AcknowledgementReportDto,
  type AcknowledgementReportQuery,
  type AcknowledgementReportRowDto,
  type AcquaintanceStatus,
  type DisciplineGroupDto,
  type DisciplineReportDto,
  type DisciplineReportQuery,
  type DisciplineRowDto,
  type DisciplineTotals,
} from '@cuks/shared';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB } from '../../common/db/db.module';
import { AppException } from '../../common/exceptions/app.exception';
import { canViewDocumentBase } from './document-visibility';
import { DistributionsService } from './distributions.service';

/** КЧС letterhead for the exported report (the file is always ru, like the analytics export). */
const ORG_NAME = 'Комитет по чрезвычайным ситуациям и гражданской обороне';
const REPORT_TITLE = 'Отчёт исполнительской дисциплины';
/** Executors with no primary position land here (also the XLSX label for that group). */
const NO_SUBDIVISION = 'Без подразделения';
const ACQUAINTANCE_REPORT_TITLE = 'Отчёт по ознакомлению';
/** Russian labels for the XLSX. `expired` must never read as compliance (docs/modules/11 §12.3). */
const ACQUAINTANCE_STATUS_LABELS: Record<AcquaintanceStatus, string> = {
  pending: 'Ожидает',
  acknowledged: 'Ознакомлен',
  expired: 'Не ознакомился',
  cancelled: 'Отменено',
};

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
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly distributions: DistributionsService,
  ) {}

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

  /**
   * Who was told to read what, and who actually did (plan этап 7 «отчёт по ознакомлению»).
   *
   * Unlike the discipline report above, this one NAMES documents and readers, so the
   * permission is not the gate: every row is checked against the caller's own visibility of
   * its document, and a row they may not see is DROPPED rather than redacted. A redacted row
   * would still disclose that a ДСП order exists and how many people are on its list — which
   * is the allow-list itself (docs/09 §3). How many were dropped is reported as a count, so
   * the reader knows the sheet is partial.
   */
  async acknowledgement(
    query: AcknowledgementReportQuery,
    actor: AuthUser,
  ): Promise<AcknowledgementReportDto> {
    const orgUnitIds = query.orgUnitId ? await this.subtreeUnitIds(query.orgUnitId) : undefined;
    const raw = await this.distributions.reportRows(
      new Date(query.from),
      new Date(query.to),
      orgUnitIds,
    );

    const rows: AcknowledgementReportRowDto[] = [];
    let hiddenCount = 0;
    for (const r of raw) {
      if (!canViewDocumentBase(r.doc, actor)) {
        hiddenCount += 1;
        continue;
      }
      rows.push({
        documentId: r.doc.id,
        regNumber: r.doc.regNumber,
        subject: r.doc.subject,
        userName: r.userName,
        orgUnitName: r.orgUnitName,
        status: r.status,
        acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
      });
    }

    return {
      from: query.from,
      to: query.to,
      rows,
      totals: {
        total: rows.length,
        acknowledged: rows.filter((r) => r.status === 'acknowledged').length,
        pending: rows.filter((r) => r.status === 'pending').length,
        // Counted apart from both: the batch opened without them, which is not a reading.
        expired: rows.filter((r) => r.status === 'expired').length,
      },
      hiddenCount,
    };
  }

  /** The same report as an XLSX buffer, over exactly the rows the caller may see. */
  async acknowledgementXlsx(query: AcknowledgementReportQuery, actor: AuthUser): Promise<Buffer> {
    const report = await this.acknowledgement(query, actor);
    const header: XlsxRow = ['Номер', 'Документ', 'Подразделение', 'Сотрудник', 'Статус', 'Дата'];
    const rows: XlsxRow[] = [
      [ORG_NAME],
      [ACQUAINTANCE_REPORT_TITLE],
      [`Период: ${query.from.slice(0, 10)} — ${query.to.slice(0, 10)}`],
      [],
      header,
    ];
    for (const row of report.rows) {
      rows.push([
        row.regNumber ?? '—',
        row.subject,
        row.orgUnitName ?? NO_SUBDIVISION,
        row.userName ?? '—',
        ACQUAINTANCE_STATUS_LABELS[row.status],
        row.acknowledgedAt ? row.acknowledgedAt.slice(0, 19).replace('T', ' ') : '—',
      ]);
    }
    rows.push([]);
    rows.push([
      'Итого',
      `${report.totals.total} строк`,
      '',
      '',
      `Ознакомлены: ${report.totals.acknowledged}; ожидают: ${report.totals.pending}; не ознакомились: ${report.totals.expired}`,
      '',
    ]);
    if (report.hiddenCount > 0) {
      // Named, not hidden: a partial sheet that does not say it is partial is misleading.
      rows.push([`Скрыто строк по правам доступа: ${report.hiddenCount}`]);
    }
    return Buffer.from(buildXlsx(rows, 'Ознакомление'));
  }

  /** The unit itself plus every descendant, as ids (this report filters rows by them). */
  private async subtreeUnitIds(orgUnitId: string): Promise<string[]> {
    const [unit] = await this.db
      .select({ id: orgUnits.id, path: orgUnits.path })
      .from(orgUnits)
      .where(and(eq(orgUnits.id, orgUnitId), isNull(orgUnits.deletedAt)))
      .limit(1);
    if (!unit) throw AppException.notFound('docflow.org_unit.not_found', 'Org unit not found');
    const rows = await this.db
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(and(sql`${orgUnits.path} like ${`${unit.path}.%`}`, isNull(orgUnits.deletedAt)));
    return [unit.id, ...rows.map((r) => r.id)];
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
