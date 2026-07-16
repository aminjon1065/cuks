import type { TaskPriority } from '@cuks/shared';

/** Priority stripe colour (docs/modules/15 §3): p1 danger → p4 muted. */
export const PRIORITY_STRIPE: Record<TaskPriority, string> = {
  p1: 'bg-danger',
  p2: 'bg-warning',
  p3: 'bg-primary',
  p4: 'bg-border',
};

/** Due-date badge tone by proximity (overdue → danger, ≤1 day → warning, else neutral). */
export function dueTone(
  dueIso: string | null,
  completed: boolean,
): 'neutral' | 'warning' | 'danger' {
  if (!dueIso || completed) return 'neutral';
  const ms = new Date(dueIso).getTime() - Date.now();
  if (ms < 0) return 'danger';
  if (ms < 24 * 60 * 60 * 1000) return 'warning';
  return 'neutral';
}

/** Deterministic dot colour for a label id (until label colours are edited, task 4.3). */
export function labelDot(color: string): string {
  const map: Record<string, string> = {
    red: 'bg-danger',
    orange: 'bg-warning',
    green: 'bg-success',
    blue: 'bg-primary',
    gray: 'bg-text-muted',
  };
  return map[color] ?? 'bg-primary';
}
