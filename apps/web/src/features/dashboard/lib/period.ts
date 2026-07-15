/** The operational-summary period options (docs/modules/10 §8, task 2.10). */
export const DASHBOARD_PERIODS = ['day', 'week', 'month'] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

const PERIOD_DAYS: Record<DashboardPeriod, number> = { day: 1, week: 7, month: 30 };

/** Week by default — a fuller operational picture than a single day. */
export const DEFAULT_PERIOD: DashboardPeriod = 'week';

export interface PeriodWindow {
  from: string;
  to: string;
}

/**
 * A rolling window ending now (`now` injectable for tests). Rolling — not
 * calendar-aligned — so the previous window the API derives for deltas is an
 * exact equal-length span (the 24h/7d/30d immediately before). The instant is
 * timezone-independent; only labels render in Asia/Dushanbe.
 */
export function periodWindow(period: DashboardPeriod, now: Date = new Date()): PeriodWindow {
  const to = now;
  const from = new Date(to.getTime() - PERIOD_DAYS[period] * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString() };
}
