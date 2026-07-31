import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { documentDispatches, documents, journals, nomenclature, type Database } from '@cuks/db';
import type {
  RegisterReportDto,
  RegisterReportKind,
  RegisterReportQuery,
  RegisterReportRow,
} from '@cuks/shared';
import { buildXlsx, type XlsxRow } from '@cuks/shared/office/xlsx';
import type { AuthUser } from '../../common/auth/auth-user';
import { DB } from '../../common/db/db.module';
import { visibleDocumentsWhere } from './document-visibility';
import { RoutesService } from './routes.service';

/**
 * The five register reports (plan этап 9).
 *
 * Every one of them is an aggregate over documents the CALLER may see — the visibility
 * predicate is inside the query, exactly as it is for the list and the search. A report is
 * the easiest place in a product to leak a register wholesale: nobody expects a total to be
 * a disclosure, but «в журнале ДСП за март — 14 документов» is one.
 *
 * The period is a range on `reg_date` in Asia/Dushanbe days, because that is the calendar the
 * registration numbers themselves are minted against (docs/modules/11 §3). A range rather
 * than `extract(year …)`: an expression around the column cannot use an index, and these
 * reports are the queries most likely to be run over the whole register.
 */
@Injectable()
export class RegisterReportsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly routes: RoutesService,
  ) {}

  async report(query: RegisterReportQuery, actor: AuthUser): Promise<RegisterReportDto> {
    const assignments = await this.routes.actingAssignments(actor.id);
    const visible = visibleDocumentsWhere(actor, assignments);
    const period = and(
      sql`${documents.regDate} >= (${query.from}::date ${LOCAL_TZ})`,
      sql`${documents.regDate} < ((${query.to}::date + 1) ${LOCAL_TZ})`,
    );
    const base = and(isNull(documents.deletedAt), visible);

    // Two reports are not about registration at all, so they get their own ranges over the
    // date each is actually named after.
    const filedRange = and(
      sql`${documents.archivedAt} >= (${query.from}::date ${LOCAL_TZ})`,
      sql`${documents.archivedAt} < ((${query.to}::date + 1) ${LOCAL_TZ})`,
    );
    const sentRange = and(
      sql`${documentDispatches.createdAt} >= (${query.from}::date ${LOCAL_TZ})`,
      sql`${documentDispatches.createdAt} < ((${query.to}::date + 1) ${LOCAL_TZ})`,
    );
    const built = await this.rowsFor(query.kind, base, period, filedRange, sentRange);
    return {
      kind: query.kind,
      from: query.from,
      to: query.to,
      columns: COLUMNS[query.kind],
      rows: built,
      totals: COLUMNS[query.kind].map((_, i) =>
        built.reduce((sum, r) => sum + (r.values[i] ?? 0), 0),
      ),
    };
  }

  async xlsx(query: RegisterReportQuery, actor: AuthUser): Promise<Buffer> {
    const report = await this.report(query, actor);
    const rows: XlsxRow[] = [
      [ORG_NAME],
      [TITLES[report.kind]],
      [`за период ${report.from} — ${report.to}`],
      [],
      ['Группа', 'Уточнение', ...report.columns.map((c) => COLUMN_LABELS[c] ?? c)],
    ];
    for (const row of report.rows) rows.push([row.label, row.hint ?? '', ...row.values]);
    rows.push([]);
    rows.push(['Итого', '', ...report.totals]);
    return Buffer.from(buildXlsx(rows, 'Отчёт'));
  }

  // --- the five queries -------------------------------------------------------------

  private async rowsFor(
    kind: RegisterReportKind,
    base: SQL | undefined,
    period: SQL | undefined,
    filedRange: SQL | undefined,
    sentRange: SQL | undefined,
  ): Promise<RegisterReportRow[]> {
    switch (kind) {
      case 'movement':
        return this.movement(base, period);
      case 'registration':
        return this.registration(base, period);
      case 'deadlines':
        return this.deadlines(base, period);
      case 'dispatch':
        return this.dispatch(base, period, sentRange);
      case 'archive':
        return this.archive(base, period, filedRange);
    }
  }

  /** Оборот по журналам: what arrived, what is still moving, what closed. */
  private async movement(base: SQL | undefined, period: SQL | undefined): Promise<Row[]> {
    const rows = await this.db
      .select({
        label: sql<string>`coalesce(${journals.name}, ${UNFILED})`,
        hint: sql<string | null>`${journals.docClass}`,
        registered: count(sql`true`),
        inProgress: count(sql`${documents.status} = 'in_progress'`),
        completed: count(sql`${documents.status} = 'completed'`),
        archived: count(sql`${documents.archivedAt} is not null`),
      })
      .from(documents)
      .leftJoin(journals, eq(journals.id, documents.journalId))
      .where(and(base, period))
      .groupBy(journals.name, journals.docClass)
      .orderBy(sql`coalesce(${journals.name}, ${UNFILED})`);
    return rows.map((r) => ({
      label: r.label,
      hint: r.hint,
      values: [r.registered, r.inProgress, r.completed, r.archived],
    }));
  }

  /** The registration book: how many numbers each journal actually minted in the period. */
  private async registration(base: SQL | undefined, period: SQL | undefined): Promise<Row[]> {
    const rows = await this.db
      .select({
        label: sql<string>`coalesce(${journals.name}, ${UNFILED})`,
        hint: sql<string | null>`${journals.code}`,
        numbers: count(sql`${documents.regNumber} is not null`),
        dsp: count(sql`${documents.confidentiality} = 'dsp'`),
        withFile: count(
          sql`exists (select 1 from app.document_files df where df.document_id = ${documents.id} and df.is_current)`,
        ),
      })
      .from(documents)
      .leftJoin(journals, eq(journals.id, documents.journalId))
      .where(and(base, period, sql`${documents.regNumber} is not null`))
      .groupBy(journals.name, journals.code)
      .orderBy(sql`coalesce(${journals.name}, ${UNFILED})`);
    return rows.map((r) => ({
      label: r.label,
      hint: r.hint,
      values: [r.numbers, r.dsp, r.withFile],
    }));
  }

  /**
   * Document deadlines — how the register itself stands, grouped by class.
   *
   * Not a duplicate of the discipline report: that one measures PEOPLE against the
   * instructions they were given, this one measures the register against its own dates. They
   * disagree on purpose — a document can be late while every instruction on it was executed.
   */
  private async deadlines(base: SQL | undefined, period: SQL | undefined): Promise<Row[]> {
    const open = sql`${documents.status} in ('registered', 'in_progress', 'on_route', 'pending_registration')`;
    const rows = await this.db
      .select({
        label: sql<string>`${documents.docClass}`,
        withDeadline: count(sql`${documents.dueDate} is not null`),
        overdue: count(
          sql`${documents.dueDate} is not null and ${documents.dueDate} < now() and ${open}`,
        ),
        dueSoon: count(
          sql`${documents.dueDate} is not null and ${documents.dueDate} >= now()
              and ${documents.dueDate} < now() + interval '3 days' and ${open}`,
        ),
        closed: count(sql`${documents.status} in ('completed', 'archived')`),
      })
      .from(documents)
      .where(and(base, period))
      .groupBy(documents.docClass)
      .orderBy(documents.docClass);
    return rows.map((r) => ({
      label: r.label,
      hint: null,
      values: [r.withDeadline, r.overdue, r.dueSoon, r.closed],
    }));
  }

  /**
   * Отправка, by channel. Counted over DISPATCHES, not documents: a letter sent twice down
   * two channels is two sends, and a report about sending that says otherwise is wrong about
   * the thing it is named after. For the same reason the period ranges over when the dispatch
   * was RECORDED, not when its document was registered — «отправлено за март» is a question
   * about March sends, and a letter registered in January can be sent in March.
   */
  private async dispatch(
    base: SQL | undefined,
    _period: SQL | undefined,
    sentRange: SQL | undefined,
  ): Promise<Row[]> {
    const rows = await this.db
      .select({
        label: sql<string>`${documentDispatches.channel}`,
        sent: count(sql`${documentDispatches.status} = 'sent'`),
        pending: count(sql`${documentDispatches.status} = 'pending'`),
        failed: count(sql`${documentDispatches.status} = 'failed'`),
        cancelled: count(sql`${documentDispatches.status} = 'cancelled'`),
      })
      .from(documentDispatches)
      .innerJoin(documents, eq(documents.id, documentDispatches.documentId))
      .where(and(base, sentRange))
      .groupBy(documentDispatches.channel)
      .orderBy(documentDispatches.channel);
    return rows.map((r) => ({
      label: r.label,
      hint: null,
      values: [r.sent, r.pending, r.failed, r.cancelled],
    }));
  }

  /**
   * The archive by case, FILED IN THE PERIOD — so this one ranges over `archived_at` rather
   * than `reg_date`: «сколько сдали в дело за март» is a question about filing, not about
   * when the documents were originally registered. The range is applied, not merely described:
   * the workbook prints «за период …» in its header, and a report that ignores the period it
   * advertises is worse than one that offers none.
   */
  private async archive(
    base: SQL | undefined,
    _period: SQL | undefined,
    filedRange: SQL | undefined,
  ): Promise<Row[]> {
    const rows = await this.db
      .select({
        label: sql<string>`coalesce(${documents.caseIndex}, ${NO_CASE})`,
        hint: sql<string | null>`${nomenclature.title}`,
        archived: count(sql`true`),
        permanent: count(sql`${documents.isPermanent}`),
        held: count(sql`${documents.legalHold}`),
        candidates: count(sql`${documents.dispositionStatus} = 'candidate'`),
        disposed: count(sql`${documents.dispositionStatus} = 'executed'`),
      })
      .from(documents)
      .leftJoin(
        nomenclature,
        and(eq(nomenclature.index, documents.caseIndex), isNull(nomenclature.deletedAt)),
      )
      .where(and(base, sql`${documents.archivedAt} is not null`, filedRange))
      .groupBy(documents.caseIndex, nomenclature.title)
      .orderBy(sql`coalesce(${documents.caseIndex}, ${NO_CASE})`);
    return rows.map((r) => ({
      label: r.label,
      hint: r.hint,
      values: [r.archived, r.permanent, r.held, r.candidates, r.disposed],
    }));
  }
}

type Row = RegisterReportRow;

/** `count(*) filter (…)` as an int — the shape every column in this file has. */
function count(predicate: SQL): SQL<number> {
  return sql<number>`count(*) filter (where ${predicate})::int`;
}

const ORG_NAME = 'Комитет по чрезвычайным ситуациям и гражданской обороне';
const UNFILED = 'Без журнала';
const NO_CASE = 'Без дела';
/** The Dushanbe calendar, inline so the expression is identical in every bound. */
const LOCAL_TZ = sql.raw("at time zone 'Asia/Dushanbe'");

const COLUMNS: Record<RegisterReportKind, string[]> = {
  movement: ['registered', 'inProgress', 'completed', 'archived'],
  registration: ['numbers', 'dsp', 'withFile'],
  deadlines: ['withDeadline', 'overdue', 'dueSoon', 'closed'],
  dispatch: ['sent', 'pending', 'failed', 'cancelled'],
  archive: ['archived', 'permanent', 'held', 'candidates', 'disposed'],
};

const TITLES: Record<RegisterReportKind, string> = {
  movement: 'Движение документов',
  registration: 'Регистрация документов',
  deadlines: 'Сроки исполнения документов',
  dispatch: 'Отправка корреспонденции',
  archive: 'Архивное хранение',
};

/** Russian headers for the export. The API sends keys; only the workbook needs words. */
const COLUMN_LABELS: Record<string, string> = {
  registered: 'Всего',
  inProgress: 'В работе',
  completed: 'Завершено',
  archived: 'Сдано в дело',
  numbers: 'Зарегистрировано',
  dsp: 'ДСП',
  withFile: 'С вложением',
  withDeadline: 'Со сроком',
  overdue: 'Просрочено',
  dueSoon: 'Срок истекает',
  closed: 'Закрыто',
  sent: 'Отправлено',
  pending: 'В очереди',
  failed: 'Ошибка',
  cancelled: 'Отменено',
  permanent: 'Постоянно',
  held: 'Под запретом',
  candidates: 'Кандидаты',
  disposed: 'Выбыло',
};
