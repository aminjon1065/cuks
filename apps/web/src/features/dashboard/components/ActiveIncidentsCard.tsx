import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { MapPin } from 'lucide-react';
import { EmptyState, Skeleton } from '@cuks/ui';
import type { AnalyticsSummaryDto } from '@cuks/shared';

// Lazy so maplibre-gl stays out of the dashboard's initial bundle (it is the
// app's home page); it loads only once there are points to draw.
const ActiveIncidentsMap = lazy(() => import('./ActiveIncidentsMap'));

/** The active-incidents inset map with its loading/empty states and a badge when
 *  the point set was capped (docs/modules/10 §8). */
export function ActiveIncidentsCard({
  active,
  loading,
}: {
  active: AnalyticsSummaryDto['activeIncidents'] | undefined;
  loading: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('dashboard');

  if (loading || !active) {
    return <Skeleton className="h-[340px] w-full rounded-md" />;
  }
  if (active.points.length === 0) {
    return (
      <div className="flex h-[340px] items-center justify-center">
        <EmptyState
          icon={MapPin}
          title={t('map.emptyTitle')}
          description={t('map.emptyDescription')}
        />
      </div>
    );
  }

  return (
    <div className="relative h-[340px] overflow-hidden rounded-md border border-border">
      <Suspense fallback={<Skeleton className="h-full w-full" />}>
        <ActiveIncidentsMap points={active.points} />
      </Suspense>
      <div className="pointer-events-none absolute bottom-2 left-2 rounded-sm border border-border bg-surface/90 px-2 py-1 text-xs text-text-muted shadow-[var(--shadow-1)]">
        {active.truncated
          ? t('map.countTruncated', { shown: active.points.length, total: active.total })
          : t('map.count', { total: active.total })}
      </div>
    </div>
  );
}
