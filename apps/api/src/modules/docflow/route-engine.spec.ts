import { describe, expect, it } from 'vitest';
import { planApproval, stepsToActivateOnStart, type RouteStepState } from './route-engine';

const step = (id: string, order: number, status: RouteStepState['status']): RouteStepState => ({
  id,
  stepOrder: order,
  status,
});

describe('stepsToActivateOnStart', () => {
  it('activates only the lowest-order group', () => {
    const steps = [step('a', 1, 'pending'), step('b', 1, 'pending'), step('c', 2, 'pending')];
    expect(stepsToActivateOnStart(steps).sort()).toEqual(['a', 'b']);
  });

  it('returns nothing for an empty route', () => {
    expect(stepsToActivateOnStart([])).toEqual([]);
  });
});

describe('planApproval', () => {
  it('completes a single-step route on the only approval', () => {
    // The lone step is its own (last) group, so approving it completes the route.
    expect(planApproval([step('a', 1, 'active')], 'a')).toEqual({
      activateStepIds: [],
      routeComplete: true,
    });
  });

  it('waits for the whole parallel group before advancing', () => {
    const steps = [step('a', 1, 'active'), step('b', 1, 'active'), step('c', 2, 'pending')];
    // Approving one of two parallel steps: the group is not yet complete.
    expect(planApproval(steps, 'a')).toEqual({ activateStepIds: [], routeComplete: false });
    // Once the first is done, approving the second activates the next group.
    const afterA = [step('a', 1, 'done'), step('b', 1, 'active'), step('c', 2, 'pending')];
    expect(planApproval(afterA, 'b')).toEqual({ activateStepIds: ['c'], routeComplete: false });
  });

  it('activates the next order group when the current one completes', () => {
    const steps = [step('a', 1, 'active'), step('b', 2, 'pending'), step('c', 2, 'pending')];
    expect(planApproval(steps, 'a')).toEqual({
      activateStepIds: ['b', 'c'],
      routeComplete: false,
    });
  });

  it('marks the route complete when the last group is done', () => {
    const steps = [step('a', 1, 'done'), step('b', 2, 'active')];
    expect(planApproval(steps, 'b')).toEqual({ activateStepIds: [], routeComplete: true });
  });
});
