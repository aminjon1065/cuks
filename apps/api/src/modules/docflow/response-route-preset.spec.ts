import { describe, expect, it } from 'vitest';
import { AppException } from '../../common/exceptions/app.exception';
import { buildResponseRoutePreset } from './response-route-preset';

const HEAD = '00000000-0000-4000-8000-000000000001';
const SIGNER = '00000000-0000-4000-8000-000000000002';
const APPROVER_A = '00000000-0000-4000-8000-000000000003';
const APPROVER_B = '00000000-0000-4000-8000-000000000004';
const REGISTRY = '00000000-0000-4000-8000-000000000005';

describe('buildResponseRoutePreset', () => {
  it('orders the answer: head approval, then signature', () => {
    const steps = buildResponseRoutePreset({
      headPositionId: HEAD,
      approverIds: [],
      signerId: null,
      registryOrgUnitId: null,
    });
    expect(steps).toEqual([
      { order: 1, kind: 'approve', assigneeType: 'position', assigneeId: HEAD, dueHours: null },
      { order: 3, kind: 'sign', assigneeType: 'position', assigneeId: HEAD, dueHours: null },
    ]);
  });

  it('puts extra approvers in ONE parallel group between the head and the signature', () => {
    const steps = buildResponseRoutePreset({
      headPositionId: HEAD,
      approverIds: [APPROVER_A, APPROVER_B],
      signerId: SIGNER,
      registryOrgUnitId: null,
    });
    const extra = steps.filter((s) => s.assigneeType === 'user' && s.kind === 'approve');
    expect(extra).toHaveLength(2);
    // Same order = one parallel group: the answer waits for the slowest, not for the sum.
    expect(new Set(extra.map((s) => s.order))).toEqual(new Set([2]));
    expect(steps.at(-1)).toMatchObject({ kind: 'sign', assigneeId: SIGNER, order: 3 });
  });

  it('never asks one person to approve twice', () => {
    const steps = buildResponseRoutePreset({
      headPositionId: HEAD,
      approverIds: [APPROVER_A, APPROVER_A],
      signerId: SIGNER,
      registryOrgUnitId: null,
    });
    // The second approval could never arrive, and the route would stall forever.
    expect(steps.filter((s) => s.assigneeId === APPROVER_A)).toHaveLength(1);
  });

  it('addresses the head by POSITION so a vacancy fails the dry-run', () => {
    const [first] = buildResponseRoutePreset({
      headPositionId: HEAD,
      approverIds: [],
      signerId: SIGNER,
      registryOrgUnitId: null,
    });
    // `org_unit` would expand to every member of the unit, hiding a vacant head.
    expect(first).toMatchObject({ assigneeType: 'position', assigneeId: HEAD });
  });

  it('signs by the named person when one is given, head or not', () => {
    const steps = buildResponseRoutePreset({
      headPositionId: null,
      approverIds: [],
      signerId: SIGNER,
      registryOrgUnitId: null,
    });
    expect(steps).toEqual([
      { order: 3, kind: 'sign', assigneeType: 'user', assigneeId: SIGNER, dueHours: null },
    ]);
  });

  it('refuses to build a route nobody can sign', () => {
    // Better a clear refusal now than an answer stranded on its last step.
    expect(() =>
      buildResponseRoutePreset({
        headPositionId: null,
        approverIds: [APPROVER_A],
        signerId: null,
        registryOrgUnitId: null,
      }),
    ).toThrow(AppException);
  });

  it('adds a register step only when a registry unit is named', () => {
    const without = buildResponseRoutePreset({
      headPositionId: HEAD,
      approverIds: [],
      signerId: SIGNER,
      registryOrgUnitId: null,
    });
    expect(without.some((s) => s.kind === 'register')).toBe(false);

    const withRegistry = buildResponseRoutePreset({
      headPositionId: HEAD,
      approverIds: [],
      signerId: SIGNER,
      registryOrgUnitId: REGISTRY,
    });
    expect(withRegistry.at(-1)).toMatchObject({
      kind: 'register',
      assigneeType: 'org_unit',
      assigneeId: REGISTRY,
      order: 4,
    });
  });

  it('carries the SLA down to every step that has one', () => {
    const steps = buildResponseRoutePreset({
      headPositionId: HEAD,
      approverIds: [APPROVER_A],
      signerId: SIGNER,
      registryOrgUnitId: null,
      approvalHours: 24,
      signHours: 8,
    });
    expect(steps.filter((s) => s.kind === 'approve').every((s) => s.dueHours === 24)).toBe(true);
    expect(steps.find((s) => s.kind === 'sign')?.dueHours).toBe(8);
  });
});
