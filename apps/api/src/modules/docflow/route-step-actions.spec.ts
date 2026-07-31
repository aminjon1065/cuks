import { describe, expect, it } from 'vitest';
import {
  ROUTE_STEP_ACTIONS,
  ROUTE_STEP_KINDS,
  routeStepAllows,
  routeStepRowAction,
  type RouteStepAction,
  type RouteStepKind,
} from '@cuks/shared';
import { assertStepActionAllowed } from './routes.service';

/** The one action that may close each kind, besides the universal `reject`. */
const COMPLETION: Record<RouteStepKind, RouteStepAction> = {
  approve: 'approve',
  sign: 'sign',
  register: 'register',
  acknowledge: 'acknowledge',
  execute: 'complete',
};

describe('assertStepActionAllowed — the full kind × action matrix', () => {
  it('accepts exactly the completion action and reject, for every kind', () => {
    for (const kind of ROUTE_STEP_KINDS) {
      const allowed: RouteStepAction[] = [COMPLETION[kind], 'reject'];
      for (const action of ROUTE_STEP_ACTIONS) {
        const shouldPass = allowed.includes(action);
        if (shouldPass) {
          expect(() => assertStepActionAllowed(kind, action), `${kind} ← ${action}`).not.toThrow();
        } else {
          expect(() => assertStepActionAllowed(kind, action), `${kind} ← ${action}`).toThrow();
        }
        expect(routeStepAllows(kind, action), `${kind} ← ${action}`).toBe(shouldPass);
      }
    }
  });

  it('lets every kind be declined — reject is the recovery path back to the author', () => {
    for (const kind of ROUTE_STEP_KINDS) {
      expect(() => assertStepActionAllowed(kind, 'reject')).not.toThrow();
    }
  });

  it('refuses to close a signature step with a plain approval', () => {
    // A `sign` step's guarantee IS the cryptographic signature (docs/09 §4); approving it
    // would record a decision no certificate ever backed.
    try {
      assertStepActionAllowed('sign', 'approve');
      expect.unreachable('a sign step must not be approvable');
    } catch (error) {
      expect(error).toMatchObject({
        code: 'docflow.route_step.action_kind_mismatch',
        details: { kind: 'sign', action: 'approve' },
      });
    }
  });

  it('refuses to close an acknowledge step before its readers have read it', () => {
    expect(() => assertStepActionAllowed('acknowledge', 'approve')).toThrow();
    expect(() => assertStepActionAllowed('acknowledge', 'complete')).toThrow();
  });

  it('refuses to close a register step without minting a number', () => {
    expect(() => assertStepActionAllowed('register', 'approve')).toThrow();
    expect(() => assertStepActionAllowed('register', 'complete')).toThrow();
  });

  it('refuses to close an execute step by approving it', () => {
    expect(() => assertStepActionAllowed('execute', 'approve')).toThrow();
    expect(() => assertStepActionAllowed('execute', 'complete')).not.toThrow();
  });
});

describe('routeStepRowAction — which steps offer a button on their own row', () => {
  it('offers approve and complete, and nothing for the delegated kinds', () => {
    expect(routeStepRowAction('approve')).toBe('approve');
    expect(routeStepRowAction('execute')).toBe('complete');
    // Completed from the signature dialog / acquaintance sheet / registration action.
    expect(routeStepRowAction('sign')).toBeNull();
    expect(routeStepRowAction('acknowledge')).toBeNull();
    expect(routeStepRowAction('register')).toBeNull();
  });

  it('never offers a row action the server would refuse', () => {
    for (const kind of ROUTE_STEP_KINDS) {
      const action = routeStepRowAction(kind);
      if (action) expect(routeStepAllows(kind, action), `${kind} ← ${action}`).toBe(true);
    }
  });
});
