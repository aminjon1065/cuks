import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Loader2, MapPin, Search, X } from 'lucide-react';
import type { GisPlaceHitDto, GisPlacesSearchResponse } from '@cuks/shared';
import { Button, Input, cn } from '@cuks/ui';
import { api } from '@/lib/api-client';
import { mapKey } from '../api/queries';
import type { Bounds } from '../lib/geo';
import { parseCoordinates, pointBounds } from '../lib/place-search';

export type MapSearchTarget = {
  label: string;
  bounds: Bounds;
};

export interface MapSearchProps {
  onGoTo: (target: MapSearchTarget) => void;
}

const DEBOUNCE_MS = 250;

/**
 * Map place search (docs/modules/10 §4): type a district / facility name or paste
 * coordinates; picking a result flies the map to its bounds.
 */
export function MapSearch({ onGoTo }: MapSearchProps): React.JSX.Element {
  const { t } = useTranslation('map');
  const listId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    const handle = window.setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    const onDoc = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const coords = useMemo(() => parseCoordinates(debounced), [debounced]);

  const placesQuery = useQuery({
    queryKey: [...mapKey, 'places', debounced],
    queryFn: () =>
      api.get<GisPlacesSearchResponse>(
        `/v1/gis/places/search?q=${encodeURIComponent(debounced)}&limit=8`,
      ),
    enabled: debounced.length >= 2 && !coords,
    staleTime: 60_000,
  });

  const items = useMemo(() => {
    const result: Array<{ key: string; label: string; hint: string; bounds: Bounds }> = [];
    if (coords) {
      result.push({
        key: 'coords',
        label: t('search.coordinates', {
          lat: coords.lat.toFixed(5),
          lon: coords.lon.toFixed(5),
        }),
        hint: t('search.coordinatesHint'),
        bounds: pointBounds(coords.lon, coords.lat),
      });
    }
    for (const hit of placesQuery.data?.items ?? []) {
      result.push({
        key: `${hit.kind}:${hit.id}`,
        label: hit.label,
        hint: placeHint(hit, t),
        bounds: hit.bounds,
      });
    }
    return result;
  }, [coords, placesQuery.data, t]);

  useEffect(() => {
    setActiveIndex(0);
  }, [items]);

  const go = (index: number): void => {
    const item = items[index];
    if (!item) return;
    onGoTo({ label: item.label, bounds: item.bounds });
    setQuery(item.label);
    setOpen(false);
  };

  const showList = open && debounced.length > 0;
  const loading = placesQuery.isFetching && !coords;

  return (
    <div ref={rootRef} className="relative w-full" data-testid="map-search">
      <div className="flex items-center gap-1 rounded border border-border bg-surface px-2 shadow-[var(--shadow-2)]">
        <Search className="size-4 shrink-0 text-text-muted" aria-hidden />
        <Input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActiveIndex((i) => Math.min(i + 1, Math.max(items.length - 1, 0)));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActiveIndex((i) => Math.max(i - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              go(activeIndex);
            } else if (event.key === 'Escape') {
              setOpen(false);
            }
          }}
          placeholder={t('search.placeholder')}
          aria-label={t('search.label')}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={showList}
          className="h-9 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0"
          data-testid="map-search-input"
        />
        {loading ? <Loader2 className="size-4 shrink-0 animate-spin text-text-muted" /> : null}
        {query ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 text-text-muted"
            aria-label={t('search.clear')}
            onClick={() => {
              setQuery('');
              setOpen(false);
            }}
          >
            <X className="size-3.5" />
          </Button>
        ) : null}
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded border border-border bg-surface py-1 shadow-[var(--shadow-2)]"
        >
          {loading && items.length === 0 ? (
            <li className="px-3 py-2 text-xs text-text-muted">{t('search.loading')}</li>
          ) : items.length === 0 ? (
            <li className="px-3 py-2 text-xs text-text-muted">{t('search.empty')}</li>
          ) : (
            items.map((item, index) => (
              <li key={item.key} role="option" aria-selected={index === activeIndex}>
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-start gap-2 px-3 py-2 text-left text-[13px] hover:bg-surface-2',
                    index === activeIndex && 'bg-surface-2',
                  )}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => go(index)}
                >
                  <MapPin className="mt-0.5 size-3.5 shrink-0 text-text-muted" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-text">{item.label}</span>
                    <span className="block truncate text-xs text-text-muted">{item.hint}</span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function placeHint(hit: GisPlaceHitDto, t: (key: string) => string): string {
  if (hit.kind === 'facility') return t('search.facility');
  if (hit.level === 'region') return t('search.region');
  if (hit.level === 'district') return t('search.district');
  if (hit.level === 'jamoat') return t('search.jamoat');
  return t('search.district');
}
