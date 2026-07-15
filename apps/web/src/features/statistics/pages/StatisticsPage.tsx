import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { BarChart3, FileBarChart, Lock, Printer } from 'lucide-react';
import { Button, buttonVariants, cn, EmptyState, PageHeader, Skeleton } from '@cuks/ui';
import { useCan } from '@/lib/ability';
import { useIncidentMapFilterOptions } from '@/features/map/api/queries';
import { StatsFilterBar, type StatsFilterState } from '../components/StatsFilterBar';
import { useIncidentStats, useRegionsGeoJson } from '../api/queries';
import { DEFAULT_STATS_PERIOD, statsPeriodWindow } from '../lib/period';
import { isEmptyStats } from '../lib/chart-options';

// Lazy so the echarts runtime stays out of the initial bundle (it loads with the
// charts, not the page shell).
const StatisticsCharts = lazy(() => import('../components/StatisticsCharts'));

/**
 * «Статистика ЧС» (docs/modules/10 §8, task 2.11): period/region/type filter and
 * six ECharts charts (monthly dynamics, by type, region choropleth, day×hour
 * heatmap, top regions, casualties by type) with per-chart PNG export and print.
 */
export function StatisticsPage(): React.JSX.Element {
  const { t } = useTranslation('statistics');
  const canView = useCan('analytics.view');
  const canBuild = useCan('analytics.build');
  const [filter, setFilter] = useState<StatsFilterState>({
    period: DEFAULT_STATS_PERIOD,
    regionId: '',
    typeCode: '',
  });
  // Capture the window once per period change so the query key stays stable.
  const range = useMemo(() => statsPeriodWindow(filter.period), [filter.period]);
  const stats = useIncidentStats({
    from: range.from,
    to: range.to,
    regionId: filter.regionId || undefined,
    typeCode: filter.typeCode || undefined,
  });
  const regions = useRegionsGeoJson();
  const filterOptions = useIncidentMapFilterOptions();

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

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            {canBuild ? (
              <Link
                to="/app/analytics/reports"
                className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
              >
                <FileBarChart /> {t('reportsLink')}
              </Link>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => window.print()}>
              <Printer /> {t('print')}
            </Button>
          </div>
        }
      />
      <StatsFilterBar value={filter} onChange={setFilter} options={filterOptions.data} />

      {stats.isError ? (
        <div className="rounded-lg border border-border bg-surface p-10 text-center">
          <p className="text-sm text-danger">{t('loadFailed')}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void stats.refetch()}>
            {t('retry')}
          </Button>
        </div>
      ) : stats.isPending ? (
        <ChartsSkeleton />
      ) : isEmptyStats(stats.data.byType) ? (
        <EmptyState icon={BarChart3} title={t('emptyTitle')} description={t('emptyDescription')} />
      ) : (
        <Suspense fallback={<ChartsSkeleton />}>
          <StatisticsCharts data={stats.data} regions={regions.data} />
        </Suspense>
      )}
    </div>
  );
}

function ChartsSkeleton(): React.JSX.Element {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <Skeleton key={index} className="h-[320px] w-full rounded-lg" />
      ))}
    </div>
  );
}
