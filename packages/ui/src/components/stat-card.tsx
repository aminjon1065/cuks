import { Minus, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';
import { cn } from '../lib/cn';
import { Badge } from './badge';
import { Skeleton } from './skeleton';

export type StatDeltaDirection = 'up' | 'down' | 'flat';

export interface StatDelta {
  /** Formatted delta label, e.g. "+12%" or "+5". */
  text: string;
  direction: StatDeltaDirection;
  /** Semantic tone — chosen by the caller from the metric's meaning (for
   *  casualties a rise is `danger`), not from the sign. */
  tone: 'success' | 'danger' | 'neutral';
}

export interface StatCardProps {
  label: string;
  /** Pre-formatted value (thousands-separated, localized). */
  value: string;
  icon?: LucideIcon;
  delta?: StatDelta;
  /** Small line under the value, e.g. the previous-period figure. */
  caption?: string;
  loading?: boolean;
  className?: string;
}

const directionIcon: Record<StatDeltaDirection, LucideIcon> = {
  up: TrendingUp,
  down: TrendingDown,
  flat: Minus,
};

/**
 * A KPI/stat card (docs/06 §4 — a new shared pattern lives in `packages/ui`).
 * Presentational only: the delta's `tone` is decided by the caller so the same
 * card serves "more is better" and "more is worse" metrics.
 */
export function StatCard({
  label,
  value,
  icon: Icon,
  delta,
  caption,
  loading,
  className,
}: StatCardProps): React.JSX.Element {
  const DeltaIcon = delta ? directionIcon[delta.direction] : null;
  return (
    <div className={cn('rounded-lg border border-border bg-surface p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-text-muted">{label}</span>
        {Icon ? <Icon className="size-4 shrink-0 text-text-muted" aria-hidden /> : null}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-24" />
      ) : (
        <div className="mt-1.5 flex items-baseline gap-2">
          <span className="text-2xl font-semibold tabular-nums text-text">{value}</span>
          {delta && DeltaIcon ? (
            <Badge tone={delta.tone} className="gap-0.5">
              <DeltaIcon className="size-3" aria-hidden />
              {delta.text}
            </Badge>
          ) : null}
        </div>
      )}
      {caption && !loading ? <p className="mt-1 text-xs text-text-muted">{caption}</p> : null}
    </div>
  );
}
