import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { EmptyState, Skeleton, SeverityBadge, StatusBadge } from '@cuks/ui';
import type { SummaryReportItem } from '@cuks/shared';
import { formatRelativeTime } from '@/lib/format';
import { formatNumber, incidentStatusTone } from '@/features/incidents/lib';

/** «Лента последних донесений» — the newest situation reports across all incidents
 *  (docs/modules/10 §8). Reuses the registry's severity/status vocabulary. */
export function ReportsFeed({
  reports,
  loading,
}: {
  reports: SummaryReportItem[] | undefined;
  loading: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('dashboard');
  const { t: ti } = useTranslation('incidents');

  if (loading) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3].map((row) => (
          <Skeleton key={row} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (!reports || reports.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title={t('reports.emptyTitle')}
        description={t('reports.emptyDescription')}
      />
    );
  }

  return (
    <ul className="divide-y divide-border" data-testid="reports-feed">
      {reports.map((report) => (
        <li key={report.id} className="py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/app/incidents/${report.incidentId}`}
              className="font-mono text-[13px] font-medium text-primary hover:underline"
            >
              {report.incidentNumber}
            </Link>
            <SeverityBadge level={report.severity} label={ti(`severity.${report.severity}`)} />
            <StatusBadge
              label={ti(`status.${report.status}`)}
              tone={incidentStatusTone[report.status]}
            />
            <span className="ml-auto text-xs text-text-muted">
              {formatRelativeTime(report.reportedAt)}
            </span>
          </div>
          {report.text ? (
            <p className="mt-1 line-clamp-2 text-[13px] text-text-muted">{report.text}</p>
          ) : null}
          {report.dead || report.injured ? (
            <p className="mt-1 text-xs text-text-muted">
              {t('reports.casualties', {
                dead: formatNumber(report.dead ?? 0),
                injured: formatNumber(report.injured ?? 0),
              })}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
