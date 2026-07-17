import { useTranslation } from 'react-i18next';
import { cn } from '@cuks/ui';
import { DASHBOARD_PERIODS, type DashboardPeriod } from '../lib/period';

/** Segmented control for the operational-summary period. */
export function PeriodPicker({
  value,
  onChange,
}: {
  value: DashboardPeriod;
  onChange: (period: DashboardPeriod) => void;
}): React.JSX.Element {
  const { t } = useTranslation('dashboard');
  return (
    <div
      role="tablist"
      aria-label={t('period.label')}
      className="inline-flex rounded-sm border border-border bg-surface p-0.5"
    >
      {DASHBOARD_PERIODS.map((period) => {
        const selected = value === period;
        return (
          <button
            key={period}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(period)}
            className={cn(
              'rounded-sm px-3 py-1 text-[13px] font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
              selected ? 'bg-primary text-primary-fg' : 'text-text-muted hover:text-text',
            )}
          >
            {t(`period.${period}`)}
          </button>
        );
      })}
    </div>
  );
}
