import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import { Button, cn, EmptyState, PageHeader } from '@cuks/ui';
import { useCan } from '@/lib/ability';
import { ActiveIncidentsCard } from '../components/ActiveIncidentsCard';
import { AttentionWidget } from '../components/AttentionWidget';
import { KpiCards } from '../components/KpiCards';
import { PeriodPicker } from '../components/PeriodPicker';
import { ReportsFeed } from '../components/ReportsFeed';
import { useOperationalSummary } from '../api/queries';
import { DEFAULT_PERIOD, periodWindow, type DashboardPeriod } from '../lib/period';

/**
 * «Оперативная сводка» — the platform home (docs/modules/10 §8, task 2.10): KPIs
 * with period-over-period deltas, the active-incidents inset map, the latest
 * situation-report feed and the «Требует внимания» aggregator.
 */
export function DashboardPage(): React.JSX.Element {
  const { t } = useTranslation('dashboard');
  const canView = useCan('analytics.view');
  const [period, setPeriod] = useState<DashboardPeriod>(DEFAULT_PERIOD);
  // Capture the window once per period selection so the query key stays stable.
  const window = useMemo(() => periodWindow(period), [period]);
  const summary = useOperationalSummary(window);

  useEffect(() => {
    document.title = t('title');
  }, [t]);

  if (!canView) {
    return (
      <div className="space-y-6">
        <PageHeader title={t('title')} description={t('subtitle')} />
        <EmptyState icon={Lock} title={t('noAccessTitle')} description={t('noAccessDescription')} />
      </div>
    );
  }

  const data = summary.data;
  const loading = summary.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={<PeriodPicker value={period} onChange={setPeriod} />}
      />

      {summary.isError ? (
        <div className="rounded-lg border border-border bg-surface p-10 text-center">
          <p className="text-sm text-danger">{t('loadFailed')}</p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3"
            onClick={() => void summary.refetch()}
          >
            {t('retry')}
          </Button>
        </div>
      ) : (
        <>
          <KpiCards kpis={data?.kpis} loading={loading} />

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              <DashboardCard title={t('map.title')}>
                <ActiveIncidentsCard active={data?.activeIncidents} loading={loading} />
              </DashboardCard>
              <DashboardCard title={t('reports.title')}>
                <ReportsFeed reports={data?.latestReports} loading={loading} />
              </DashboardCard>
            </div>
            <DashboardCard title={t('attention.title')}>
              <AttentionWidget />
            </DashboardCard>
          </div>
        </>
      )}
    </div>
  );
}

function DashboardCard({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className={cn('rounded-lg border border-border bg-surface p-5', className)}>
      <h2 className="mb-4 text-sm font-semibold text-text">{title}</h2>
      {children}
    </section>
  );
}
