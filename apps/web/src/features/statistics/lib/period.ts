/** Statistics-dashboard period options — longer than the operational summary's,
 *  so the monthly-dynamics chart spans several buckets (docs/modules/10 §8). */
export const STATS_PERIODS = ['month', 'quarter', 'year'] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];

const PERIOD_DAYS: Record<StatsPeriod, number> = { month: 30, quarter: 90, year: 365 };

/** A year by default, so the monthly dynamics have context. */
export const DEFAULT_STATS_PERIOD: StatsPeriod = 'year';

export interface PeriodWindow {
  from: string;
  to: string;
}

/** A rolling window ending now (`now` injectable for tests). */
export function statsPeriodWindow(period: StatsPeriod, now: Date = new Date()): PeriodWindow {
  const to = now;
  const from = new Date(to.getTime() - PERIOD_DAYS[period] * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}
