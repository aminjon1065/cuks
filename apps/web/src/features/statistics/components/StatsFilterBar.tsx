import { useTranslation } from 'react-i18next';
import { cn } from '@cuks/ui';
import type { IncidentMapFilterOptionsResponse } from '@cuks/shared';
import { STATS_PERIODS, type StatsPeriod } from '../lib/period';

const selectClass = cn(
  'h-9 rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

export interface StatsFilterState {
  period: StatsPeriod;
  regionId: string;
  typeCode: string;
}

/** Period + region + incident-type filter (docs/modules/10 §8). Region/type options
 *  are the same reference data the map filter uses. */
export function StatsFilterBar({
  value,
  onChange,
  options,
}: {
  value: StatsFilterState;
  onChange: (next: StatsFilterState) => void;
  options: IncidentMapFilterOptionsResponse | undefined;
}): React.JSX.Element {
  const { t } = useTranslation('statistics');
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <select
        className={selectClass}
        value={value.period}
        onChange={(event) => onChange({ ...value, period: event.target.value as StatsPeriod })}
        aria-label={t('filter.period')}
      >
        {STATS_PERIODS.map((period) => (
          <option key={period} value={period}>
            {t(`period.${period}`)}
          </option>
        ))}
      </select>
      <select
        className={selectClass}
        value={value.regionId}
        onChange={(event) => onChange({ ...value, regionId: event.target.value })}
        aria-label={t('filter.region')}
      >
        <option value="">{t('filter.allRegions')}</option>
        {options?.regions.map((region) => (
          <option key={region.id} value={region.id}>
            {region.nameRu}
          </option>
        ))}
      </select>
      <select
        className={selectClass}
        value={value.typeCode}
        onChange={(event) => onChange({ ...value, typeCode: event.target.value })}
        aria-label={t('filter.type')}
      >
        <option value="">{t('filter.allTypes')}</option>
        {options?.types.map((type) => (
          <option key={type.code} value={type.code}>
            {type.parentNameRu ? `${type.parentNameRu} · ${type.nameRu}` : type.nameRu}
          </option>
        ))}
      </select>
    </div>
  );
}
