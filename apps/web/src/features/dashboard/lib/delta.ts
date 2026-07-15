import type { StatDelta } from '@cuks/ui';
import { formatNumber } from '@/features/incidents/lib';

/**
 * A KPI delta chip comparing the current period to the previous one. Every
 * operational-summary metric (incidents, casualties, damage) is "higher is
 * worse", so a rise is `danger` and a fall is `success` (docs/06 §2 — tone by
 * meaning, not sign).
 */
export function computeKpiDelta(current: number, previous: number): StatDelta {
  const diff = current - previous;
  const direction = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
  const tone = diff > 0 ? 'danger' : diff < 0 ? 'success' : 'neutral';

  let text: string;
  if (diff === 0) {
    text = '0';
  } else if (previous > 0) {
    const sign = diff > 0 ? '+' : '−';
    const pct = Math.round((diff / previous) * 100);
    text = pct === 0 ? `${sign}<1%` : `${sign}${Math.abs(pct)}%`;
  } else {
    // No previous baseline to take a percentage of — show the absolute rise.
    text = `+${formatNumber(diff)}`;
  }
  return { text, direction, tone };
}
