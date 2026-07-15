import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { RotateCcw, TriangleAlert } from 'lucide-react';
import { INCIDENT_STATUSES, type IncidentMapFilterOptionsResponse } from '@cuks/shared';
import { Button, cn, FilterBar, Skeleton } from '@cuks/ui';
import type { IncidentFilterState } from '../lib/incident-filters';

export interface IncidentFilterBarProps {
  value: IncidentFilterState;
  options: IncidentMapFilterOptionsResponse | undefined;
  loading: boolean;
  error: boolean;
  panelCollapsed: boolean;
  /** For a territory-confined user (task 2.13): the region select is pinned to these
   *  and cannot be cleared, since incident tiles for other regions are denied. */
  lockedRegionIds: readonly string[] | null;
  onChange: (value: IncidentFilterState) => void;
  onReset: () => void;
  onRetry: () => void;
}

const selectClass = cn(
  'h-9 rounded-sm border border-border bg-surface px-3 text-[13px] text-text',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
);

export function IncidentFilterBar({
  value,
  options,
  loading,
  error,
  panelCollapsed,
  lockedRegionIds,
  onChange,
  onReset,
  onRetry,
}: IncidentFilterBarProps): React.JSX.Element {
  const { t, i18n } = useTranslation('map');
  const tajik = i18n.resolvedLanguage === 'tg';
  // A user confined to a single region has no choice, so the select is locked to it.
  // A user confined to several regions may still switch among them (incident tiles are
  // per-region), so the select stays interactive but constrained to their regions.
  const regionLocked = lockedRegionIds !== null && lockedRegionIds.length <= 1;
  // A confined user's options are limited to their region(s) — a removable chip or an
  // "all regions" option would suggest a choice they don't have.
  const regionOptions = useMemo(
    () =>
      lockedRegionIds
        ? (options?.regions.filter((region) => lockedRegionIds.includes(region.id)) ?? [])
        : (options?.regions ?? []),
    [lockedRegionIds, options],
  );
  const chips = useMemo(() => {
    const result: Array<{ key: string; label: string; onRemove: () => void }> = [];
    const type = options?.types.find((item) => item.code === value.typeCode);
    const region = options?.regions.find((item) => item.id === value.regionId);
    if (type) {
      result.push({
        key: 'type',
        label: tajik ? type.nameTg : type.nameRu,
        onRemove: () => onChange({ ...value, typeCode: '' }),
      });
    }
    if (value.status) {
      result.push({
        key: 'status',
        label: t(`filters.statuses.${value.status}`),
        onRemove: () => onChange({ ...value, status: '' }),
      });
    }
    if (region && !lockedRegionIds) {
      result.push({
        key: 'region',
        label: tajik ? region.nameTg : region.nameRu,
        onRemove: () => onChange({ ...value, regionId: '' }),
      });
    }
    return result;
  }, [lockedRegionIds, onChange, options, t, tajik, value]);

  return (
    <div
      className={cn(
        'absolute right-16 top-3 z-10 rounded border border-border bg-surface p-2 shadow-[var(--shadow-2)]',
        panelCollapsed ? 'left-16' : 'left-3 md:left-80',
      )}
      data-testid="incident-filter-bar"
    >
      {loading ? (
        <div className="flex gap-2">
          <Skeleton className="h-9 w-40" />
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-9 w-36" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-xs text-danger">
          <TriangleAlert className="size-4" />
          <span>{t('filters.error')}</span>
          <Button variant="ghost" size="sm" onClick={onRetry}>
            {t('error.retry')}
          </Button>
        </div>
      ) : (
        <FilterBar
          chips={chips}
          onReset={onReset}
          resetLabel={t('filters.reset')}
          removeLabel={(chip) => t('filters.remove', { name: chip.label })}
        >
          <label className="sr-only" htmlFor="incident-type-filter">
            {t('filters.type')}
          </label>
          <select
            id="incident-type-filter"
            className={cn(selectClass, 'w-full md:w-60')}
            value={value.typeCode}
            onChange={(event) => onChange({ ...value, typeCode: event.target.value })}
          >
            <option value="">{t('filters.allTypes')}</option>
            {options?.types.map((item) => (
              <option key={item.code} value={item.code}>
                {tajik
                  ? item.parentNameTg
                    ? `${item.parentNameTg} — ${item.nameTg}`
                    : item.nameTg
                  : item.parentNameRu
                    ? `${item.parentNameRu} — ${item.nameRu}`
                    : item.nameRu}
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor="incident-status-filter">
            {t('filters.status')}
          </label>
          <select
            id="incident-status-filter"
            className={cn(selectClass, 'w-full md:w-40')}
            value={value.status}
            onChange={(event) =>
              onChange({ ...value, status: event.target.value as IncidentFilterState['status'] })
            }
          >
            <option value="">{t('filters.allStatuses')}</option>
            {INCIDENT_STATUSES.map((status) => (
              <option key={status} value={status}>
                {t(`filters.statuses.${status}`)}
              </option>
            ))}
          </select>

          <label className="sr-only" htmlFor="incident-region-filter">
            {t('filters.region')}
          </label>
          <select
            id="incident-region-filter"
            className={cn(selectClass, 'w-full md:w-48', regionLocked && 'opacity-70')}
            value={value.regionId}
            disabled={regionLocked}
            onChange={(event) => onChange({ ...value, regionId: event.target.value })}
          >
            {!lockedRegionIds && <option value="">{t('filters.allRegions')}</option>}
            {regionOptions.map((region) => (
              <option key={region.id} value={region.id}>
                {tajik ? region.nameTg : region.nameRu}
              </option>
            ))}
          </select>

          {chips.length === 0 && (
            <Button variant="ghost" size="icon" onClick={onReset} aria-label={t('filters.reset')}>
              <RotateCcw className="size-4" />
            </Button>
          )}
        </FilterBar>
      )}
    </div>
  );
}
