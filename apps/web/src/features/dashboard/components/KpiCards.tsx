import { useTranslation } from 'react-i18next';
import { AlertTriangle, Banknote, Bandage, Skull, Users, type LucideIcon } from 'lucide-react';
import { StatCard } from '@cuks/ui';
import type { AnalyticsKpis, AnalyticsMetric, AnalyticsMoneyMetric } from '@cuks/shared';
import { formatDamage, formatNumber } from '@/features/incidents/lib';
import { computeKpiDelta } from '../lib/delta';

const METRIC_ICONS: Record<keyof AnalyticsKpis, LucideIcon> = {
  incidents: AlertTriangle,
  dead: Skull,
  injured: Bandage,
  evacuated: Users,
  damage: Banknote,
};

/** The five operational KPI cards with period-over-period deltas (docs/modules/10 §8). */
export function KpiCards({
  kpis,
  loading,
}: {
  kpis: AnalyticsKpis | undefined;
  loading: boolean;
}): React.JSX.Element {
  const { t } = useTranslation('dashboard');
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {(Object.keys(METRIC_ICONS) as (keyof AnalyticsKpis)[]).map((key) => {
        const icon = METRIC_ICONS[key];
        const label = t(`kpi.${key}`);
        if (!kpis)
          return <StatCard key={key} label={label} value="" icon={icon} loading={loading} />;
        return key === 'damage' ? (
          <MoneyKpi key={key} label={label} icon={icon} metric={kpis.damage} />
        ) : (
          <CountKpi key={key} label={label} icon={icon} metric={kpis[key]} />
        );
      })}
    </div>
  );
}

function CountKpi({
  label,
  icon,
  metric,
}: {
  label: string;
  icon: LucideIcon;
  metric: AnalyticsMetric;
}): React.JSX.Element {
  const { t } = useTranslation('dashboard');
  return (
    <StatCard
      label={label}
      icon={icon}
      value={formatNumber(metric.value)}
      delta={computeKpiDelta(metric.value, metric.previous)}
      caption={t('kpi.previous', { value: formatNumber(metric.previous) })}
    />
  );
}

function MoneyKpi({
  label,
  icon,
  metric,
}: {
  label: string;
  icon: LucideIcon;
  metric: AnalyticsMoneyMetric;
}): React.JSX.Element {
  const { t } = useTranslation('dashboard');
  return (
    <StatCard
      label={label}
      icon={icon}
      value={formatDamage(metric.value) ?? '0'}
      delta={computeKpiDelta(Number(metric.value), Number(metric.previous))}
      caption={t('kpi.previous', { value: formatDamage(metric.previous) ?? '0' })}
    />
  );
}
