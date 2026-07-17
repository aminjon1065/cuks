import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BarChart3, Download } from 'lucide-react';
import {
  Button,
  EmptyState,
  Label,
  PageHeader,
  Skeleton,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  toast,
} from '@cuks/ui';
import type { DisciplineGroupDto, DisciplineReportQuery, DisciplineTotals } from '@cuks/shared';
import { exportDisciplineXlsx, useDisciplineReport } from '../api/queries';
import { useDocumentTitle } from '@/lib/use-document-title';

const inputClass = cn(
  'h-9 rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

/** Дисциплина колонка: зелёная ≥90, warning ≥70, danger ниже, нейтральная без данных. */
function disciplineTone(pct: number | null): 'success' | 'warning' | 'danger' | 'neutral' {
  if (pct === null) return 'neutral';
  if (pct >= 90) return 'success';
  if (pct >= 70) return 'warning';
  return 'danger';
}

/** First day of the current month → today, as Asia/Dushanbe (UTC+5) day boundaries. */
function defaultPeriod(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    from: `${y}-${pad(m + 1)}-01`,
    to: `${y}-${pad(m + 1)}-${pad(now.getDate())}`,
  };
}

/** «Отчёты» — исполнительская дисциплина (docs/modules/11 §5, task 3.9): за период по
 *  подразделениям/исполнителям, с экспортом в XLSX. */
export function ReportsPage(): React.JSX.Element {
  const { t } = useTranslation('docflow');
  useDocumentTitle(t('reports.title'));
  const [period, setPeriod] = useState(defaultPeriod);
  const [exporting, setExporting] = useState(false);

  const valid = period.from <= period.to;
  // Interpret the picked days as Asia/Dushanbe boundaries (matches the server's period math).
  const query: DisciplineReportQuery = useMemo(
    () => ({ from: `${period.from}T00:00:00+05:00`, to: `${period.to}T23:59:59+05:00` }),
    [period],
  );
  const report = useDisciplineReport(query, valid);

  const runExport = async (): Promise<void> => {
    setExporting(true);
    try {
      await exportDisciplineXlsx(query);
    } catch {
      toast({ title: t('reports.exportFailed'), tone: 'danger' });
    } finally {
      setExporting(false);
    }
  };

  const hasData = (report.data?.groups.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t('reports.title')} description={t('reports.subtitle')} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="report-from">{t('reports.from')}</Label>
          <input
            id="report-from"
            type="date"
            value={period.from}
            max={period.to}
            onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))}
            className={inputClass}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="report-to">{t('reports.to')}</Label>
          <input
            id="report-to"
            type="date"
            value={period.to}
            min={period.from}
            onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))}
            className={inputClass}
          />
        </div>
        <Button
          variant="secondary"
          onClick={() => void runExport()}
          disabled={!valid || !hasData || exporting}
        >
          <Download className="mr-1.5 size-4" />
          {t('reports.export')}
        </Button>
      </div>

      {!valid ? (
        <p className="text-[13px] text-danger">{t('reports.invalidPeriod')}</p>
      ) : report.isLoading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      ) : report.isError ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-[13px] text-danger">{t('common.loadError')}</p>
          <Button variant="ghost" size="sm" onClick={() => void report.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : !hasData ? (
        <EmptyState
          icon={BarChart3}
          title={t('reports.empty.title')}
          description={t('reports.empty.description')}
        />
      ) : (
        <DisciplineTable groups={report.data!.groups} totals={report.data!.totals} />
      )}
    </div>
  );
}

function DisciplineTable({
  groups,
  totals,
}: {
  groups: DisciplineGroupDto[];
  totals: DisciplineTotals;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const pct = (value: number | null) => (value === null ? '—' : `${value}%`);

  return (
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>{t('reports.columns.subdivision')}</TableHead>
          <TableHead>{t('reports.columns.executor')}</TableHead>
          <TableHead className="text-right">{t('reports.columns.total')}</TableHead>
          <TableHead className="text-right">{t('reports.columns.onTime')}</TableHead>
          <TableHead className="text-right">{t('reports.columns.late')}</TableHead>
          <TableHead className="text-right">{t('reports.columns.notDone')}</TableHead>
          <TableHead className="text-right">{t('reports.columns.discipline')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.map((group) => (
          <GroupSection key={group.orgUnitId ?? 'none'} group={group} />
        ))}
        <TableRow className="border-t-2 border-border font-semibold hover:bg-transparent">
          <TableCell colSpan={2}>{t('reports.grandTotal')}</TableCell>
          <TableCell className="text-right tabular-nums">{totals.total}</TableCell>
          <TableCell className="text-right tabular-nums">{totals.onTime}</TableCell>
          <TableCell className="text-right tabular-nums">{totals.late}</TableCell>
          <TableCell className="text-right tabular-nums">{totals.notDone}</TableCell>
          <TableCell className="text-right tabular-nums">{pct(totals.disciplinePct)}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
  );
}

function GroupSection({ group }: { group: DisciplineGroupDto }): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const label = group.orgUnitId === null ? t('reports.noSubdivision') : group.orgUnitName;
  const pct = (value: number | null) => (value === null ? '—' : `${value}%`);

  return (
    <>
      <TableRow className="bg-surface-2/60 hover:bg-surface-2/60">
        <TableCell colSpan={2} className="font-medium text-text">
          {label}
        </TableCell>
        <TableCell className="text-right font-medium tabular-nums">{group.total}</TableCell>
        <TableCell className="text-right font-medium tabular-nums">{group.onTime}</TableCell>
        <TableCell className="text-right font-medium tabular-nums">{group.late}</TableCell>
        <TableCell className="text-right font-medium tabular-nums">{group.notDone}</TableCell>
        <TableCell className="text-right">
          <StatusBadge
            tone={disciplineTone(group.disciplinePct)}
            label={pct(group.disciplinePct)}
          />
        </TableCell>
      </TableRow>
      {group.rows.map((row) => (
        <TableRow key={row.executorId}>
          <TableCell />
          <TableCell className="text-text">{row.executorName}</TableCell>
          <TableCell className="text-right tabular-nums">{row.total}</TableCell>
          <TableCell className="text-right tabular-nums text-success">{row.onTime}</TableCell>
          <TableCell className="text-right tabular-nums">{row.late}</TableCell>
          <TableCell className="text-right tabular-nums">{row.notDone}</TableCell>
          <TableCell className="text-right tabular-nums">{pct(row.disciplinePct)}</TableCell>
        </TableRow>
      ))}
    </>
  );
}
