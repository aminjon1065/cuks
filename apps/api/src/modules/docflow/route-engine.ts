import type { RouteStepStatus } from '@cuks/shared';

/** The minimal step shape the activation engine reasons over (docs/modules/11 §4). */
export interface RouteStepState {
  id: string;
  stepOrder: number;
  status: RouteStepStatus;
}

/**
 * Route activation engine (docs/modules/11 §4). Steps sharing a `stepOrder` are a
 * parallel group; groups activate in ascending order. A group is complete when all
 * its steps are `done`/`skipped`; the next group then activates, and when there is
 * no next group the route is complete. Any rejection stops the route (handled by the
 * caller). Pure — unit-tested and free of DB/time concerns.
 */

/** The steps to activate when the route starts: the lowest-order group. */
export function stepsToActivateOnStart(steps: RouteStepState[]): string[] {
  const min = lowestOrder(steps);
  return min === null ? [] : steps.filter((s) => s.stepOrder === min).map((s) => s.id);
}

export interface ApprovalPlan {
  /** Step ids to move to `active` (the next group), if any. */
  activateStepIds: string[];
  /** True when the acted step's group was the last one — the route is now complete. */
  routeComplete: boolean;
}

/**
 * Given the current step states and the id of the step just approved, decide whether
 * its parallel group is now complete and, if so, what to activate next. The acted
 * step is treated as `done` for this computation (the caller persists that).
 */
export function planApproval(steps: RouteStepState[], actedStepId: string): ApprovalPlan {
  const withActed = steps.map((s) =>
    s.id === actedStepId ? { ...s, status: 'done' as RouteStepStatus } : s,
  );
  const acted = withActed.find((s) => s.id === actedStepId);
  if (!acted) return { activateStepIds: [], routeComplete: false };

  const group = withActed.filter((s) => s.stepOrder === acted.stepOrder);
  const groupComplete = group.every((s) => s.status === 'done' || s.status === 'skipped');
  if (!groupComplete) return { activateStepIds: [], routeComplete: false };

  const nextOrder = lowestOrder(
    withActed.filter((s) => s.stepOrder > acted.stepOrder && s.status === 'pending'),
  );
  if (nextOrder === null) return { activateStepIds: [], routeComplete: true };
  return {
    activateStepIds: withActed
      .filter((s) => s.stepOrder === nextOrder && s.status === 'pending')
      .map((s) => s.id),
    routeComplete: false,
  };
}

function lowestOrder(steps: RouteStepState[]): number | null {
  if (steps.length === 0) return null;
  return steps.reduce((min, s) => (s.stepOrder < min ? s.stepOrder : min), steps[0]!.stepOrder);
}
