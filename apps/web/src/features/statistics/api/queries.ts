import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { AnalyticsStatsDto, RegionFeatureCollection } from '@cuks/shared';
import { api } from '@/lib/api-client';

/** One key namespace for the statistics feature. */
export const statisticsKey = ['statistics'] as const;

export interface StatsFilters {
  from: string;
  to: string;
  regionId?: string | undefined;
  typeCode?: string | undefined;
}

/** Incident statistics for the filter (`GET /analytics/stats`). Requires
 *  `analytics.view`; a 403 surfaces as the page's forbidden state. */
export function useIncidentStats(filters: StatsFilters): UseQueryResult<AnalyticsStatsDto> {
  const params = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.regionId) params.set('regionId', filters.regionId);
  if (filters.typeCode) params.set('typeCode', filters.typeCode);
  return useQuery({
    queryKey: [
      ...statisticsKey,
      'stats',
      filters.from,
      filters.to,
      filters.regionId ?? '',
      filters.typeCode ?? '',
    ],
    queryFn: () => api.get<AnalyticsStatsDto>(`/v1/analytics/stats?${params.toString()}`),
    staleTime: 60_000,
  });
}

/** Region boundaries for the choropleth. Static, so cached indefinitely. */
export function useRegionsGeoJson(): UseQueryResult<RegionFeatureCollection> {
  return useQuery({
    queryKey: [...statisticsKey, 'regions'],
    queryFn: () => api.get<RegionFeatureCollection>('/v1/analytics/regions.geojson'),
    staleTime: Infinity,
  });
}
