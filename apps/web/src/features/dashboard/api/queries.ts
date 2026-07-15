import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import type { AnalyticsSummaryDto } from '@cuks/shared';
import { api } from '@/lib/api-client';
import type { PeriodWindow } from '../lib/period';

/** One key namespace for the dashboard feature. */
export const dashboardKey = ['dashboard'] as const;

/**
 * The operational summary for a period (`GET /analytics/summary`). Requires
 * `analytics.view`; a 403 surfaces as the page's forbidden state.
 */
export function useOperationalSummary(window: PeriodWindow): UseQueryResult<AnalyticsSummaryDto> {
  return useQuery({
    queryKey: [...dashboardKey, 'summary', window.from, window.to],
    queryFn: () =>
      api.get<AnalyticsSummaryDto>(
        `/v1/analytics/summary?from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}`,
      ),
    staleTime: 60_000,
  });
}
