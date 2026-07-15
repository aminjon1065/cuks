import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import { EmptyState } from '@cuks/ui';
import type { AnalyticsStatsDto, RegionFeatureCollection } from '@cuks/shared';
import { formatDamage } from '@/features/incidents/lib';
import { ChartCard } from './ChartCard';
import { readChartTheme, useThemeVersion, type ChartTheme } from '../lib/echarts-theme';
import {
  byTypeOption,
  casualtiesOption,
  choroplethOption,
  heatmapOption,
  monthlyOption,
  topRegionsOption,
  type ChartLabels,
} from '../lib/chart-options';

const REGION_MAP_NAME = 'cuks-regions';

/**
 * The six statistics charts (docs/modules/10 §8). Default export so it is reached
 * only through a lazy import — this module carries the echarts runtime. Charts
 * re-resolve their colours when the app theme toggles.
 */
export default function StatisticsCharts({
  data,
  regions,
}: {
  data: AnalyticsStatsDto;
  regions: RegionFeatureCollection | undefined;
}): React.JSX.Element {
  const { t } = useTranslation('statistics');
  const themeVersion = useThemeVersion();
  const theme = useMemo<ChartTheme>(() => {
    // themeVersion bumps on a theme toggle; reading it makes the memo recompute so
    // the chart colours re-resolve for the active light/dark theme.
    void themeVersion;
    return readChartTheme();
  }, [themeVersion]);
  const labels = useMemo<ChartLabels>(
    () => ({
      incidents: t('labels.incidents'),
      dead: t('labels.dead'),
      injured: t('labels.injured'),
      evacuated: t('labels.evacuated'),
      damage: t('labels.damage'),
      dowNames: t('dow', { returnObjects: true }) as string[],
    }),
    [t],
  );

  const options = useMemo(
    () => ({
      monthly: monthlyOption(data.byMonth, theme, labels),
      byType: byTypeOption(data.byType, theme),
      choropleth: choroplethOption(data.byRegion, REGION_MAP_NAME, theme),
      heatmap: heatmapOption(data.heatmap, theme, labels),
      topRegions: topRegionsOption(data.byRegion, theme),
      casualties: casualtiesOption(
        data.casualtiesByType,
        theme,
        labels,
        (v) => formatDamage(v) ?? '0',
      ),
    }),
    [data, theme, labels],
  );

  // Stable identity so the choropleth's option effect (keyed on `map`) doesn't
  // re-register the GeoJSON and rebuild the chart on every unrelated re-render.
  const regionMap = useMemo(
    () => (regions ? { name: REGION_MAP_NAME, geoJson: regions } : undefined),
    [regions],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard
        title={t('charts.monthly')}
        option={options.monthly}
        exportName="dynamics-by-month"
      />
      <ChartCard title={t('charts.byType')} option={options.byType} exportName="by-type" />
      {regionMap ? (
        <ChartCard
          title={t('charts.choropleth')}
          option={options.choropleth}
          map={regionMap}
          exportName="by-region-map"
          height={320}
        />
      ) : (
        <section className="flex min-h-[360px] items-center justify-center rounded-lg border border-border bg-surface p-4">
          <EmptyState
            icon={MapPin}
            title={t('charts.choropleth')}
            description={t('charts.mapUnavailable')}
          />
        </section>
      )}
      <ChartCard
        title={t('charts.topRegions')}
        option={options.topRegions}
        exportName="top-regions"
        height={320}
      />
      <ChartCard
        title={t('charts.heatmap')}
        option={options.heatmap}
        exportName="heatmap-day-hour"
        height={320}
      />
      <ChartCard
        title={t('charts.casualties')}
        option={options.casualties}
        exportName="casualties-by-type"
      />
    </div>
  );
}
