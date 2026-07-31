import { describe, expect, it } from 'vitest';
import { classifyRouteDeadline, ROUTE_DUE_SOON_HOURS } from '@cuks/shared';
import {
  planApproval,
  stepDueAt,
  stepsToActivateOnStart,
  type RouteStepState,
} from './route-engine';

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

describe('stepDueAt', () => {
  const activated = new Date('2026-07-31T06:00:00.000Z');

  it('adds the SLA hours to the activation moment', () => {
    expect(stepDueAt(activated, 4)?.toISOString()).toBe('2026-07-31T10:00:00.000Z');
    expect(stepDueAt(activated, 48)?.toISOString()).toBe('2026-08-02T06:00:00.000Z');
  });

  it('gives a step without an SLA no clock at all', () => {
    // Deliberate: plenty of steps are «when you get to it», and inventing a deadline for
    // them would fill the overdue sweep with noise nobody asked for.
    expect(stepDueAt(activated, null)).toBeNull();
    expect(stepDueAt(activated, 0)).toBeNull();
    expect(stepDueAt(activated, -5)).toBeNull();
  });
});

describe('classifyRouteDeadline', () => {
  const due = new Date('2026-07-31T12:00:00.000Z');
  const at = (iso: string) => classifyRouteDeadline(due, new Date(iso));

  it('warns only inside the due-soon window', () => {
    const windowStart = new Date(due.getTime() - ROUTE_DUE_SOON_HOURS * 3_600_000);
    expect(at(new Date(windowStart.getTime() - 1000).toISOString())).toBeNull();
    expect(at(windowStart.toISOString())).toBe('due_soon');
    expect(at('2026-07-31T11:59:59.000Z')).toBe('due_soon');
  });

  it('flips to overdue the moment the deadline passes', () => {
    expect(at('2026-07-31T12:00:00.000Z')).toBe('due_soon'); // exactly due is not yet late
    expect(at('2026-07-31T12:00:00.001Z')).toBe('overdue');
    expect(at('2026-08-05T00:00:00.000Z')).toBe('overdue');
  });

  it('measures in hours, not calendar days', () => {
    // A four-hour approval rounded to a Dushanbe day would warn nobody in time.
    const shortDue = new Date('2026-07-31T10:00:00.000Z');
    expect(classifyRouteDeadline(shortDue, new Date('2026-07-31T05:00:00.000Z'))).toBeNull();
    expect(classifyRouteDeadline(shortDue, new Date('2026-07-31T07:00:00.000Z'))).toBe('due_soon');
  });
});
