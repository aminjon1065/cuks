import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileBarChart } from 'lucide-react';
import {
  Button,
  EmptyState,
  Label,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  cn,
  toast,
} from '@cuks/ui';
import { REGISTER_REPORT_KINDS, type RegisterReportKind } from '@cuks/shared';
import { exportRegisterReportXlsx, useRegisterReport } from '../api/queries';

const selectClass = cn(
  'h-9 rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

/**
 * The five register reports on one table (plan этап 9).
 *
 * The server sends column KEYS, never display text, so the workbook and the screen can word
 * things differently without the API having an opinion about either — and Tajik stays a
 * translation rather than a second server response.
 */
export function RegisterReportPanel({
  from,
  to,
  valid,
}: {
  from: string;
  to: string;
  valid: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('docflow');
  const [kind, setKind] = useState<RegisterReportKind>('movement');
  const [exporting, setExporting] = useState(false);
  const query = { kind, from, to };
  const { data, isPending, isError } = useRegisterReport(query, valid);

  const runExport = async (): Promise<void> => {
    setExporting(true);
    try {
      await exportRegisterReportXlsx(query);
    } catch {
      toast({ title: t('reports.exportFailed'), tone: 'danger' });
    } finally {
      setExporting(false);
    }
  };

  const hasRows = (data?.rows.length ?? 0) > 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="register-report-kind">{t('registerReport.kindLabel')}</Label>
          <select
            id="register-report-kind"
            className={selectClass}
            value={kind}
            onChange={(e) => setKind(e.target.value as RegisterReportKind)}
          >
            {REGISTER_REPORT_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`registerReport.kind.${k}`)}
              </option>
            ))}
          </select>
        </div>
        <Button
          variant="secondary"
          onClick={() => void runExport()}
          disabled={!valid || !hasRows || exporting}
        >
          <Download className="mr-1.5 size-4" />
          {t('reports.export')}
        </Button>
      </div>

      <p className="text-xs text-text-muted">{t(`registerReport.hint.${kind}`)}</p>

      {isPending ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          icon={FileBarChart}
          title={t('registerReport.failedTitle')}
          description={t('registerReport.failedHint')}
        />
      ) : !hasRows ? (
        <EmptyState
          icon={FileBarChart}
          title={t('registerReport.emptyTitle')}
          description={t('registerReport.emptyHint')}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('registerReport.group')}</TableHead>
              {data.columns.map((col) => (
                <TableHead key={col} className="text-right">
                  {t(`registerReport.column.${col}`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((row) => (
              <TableRow key={`${row.label}-${row.hint ?? ''}`}>
                <TableCell>
                  <span className="text-text">{groupLabel(row.label, t)}</span>
                  {row.hint ? (
                    <span className="ml-2 text-xs text-text-muted">{row.hint}</span>
                  ) : null}
                </TableCell>
                {row.values.map((v, i) => (
                  <TableCell key={data.columns[i] ?? i} className="text-right tabular-nums">
                    {v}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            <TableRow className="font-semibold">
              <TableCell>{t('reports.total')}</TableCell>
              {data.totals.map((v, i) => (
                <TableCell key={data.columns[i] ?? i} className="text-right tabular-nums">
                  {v}
                </TableCell>
              ))}
            </TableRow>
          </TableBody>
        </Table>
      )}
    </div>
  );
}

/**
 * Some groups are enum values the client already has words for (a document class, a dispatch
 * channel); the rest are data — a journal name, a case index — and are shown as they came.
 */
function groupLabel(label: string, t: (key: string) => string): string {
  const known = t(`registerReport.group_${label}`);
  return known.startsWith('registerReport.') ? label : known;
}
