import type { RouteStepInput } from '@cuks/shared';
import { AppException } from '../../common/exceptions/app.exception';

/**
 * The standard route of an outgoing answer (docs/modules/11 §12.3, plan §5.4):
 * head approval → any extra approvals in one parallel group → signature → registration.
 *
 * Built in code rather than seeded as a route template because two of its four steps name
 * people who are only known per document — the head of the preparing unit and the
 * registrar's book — and `route_templates.steps` stores concrete uuids with no placeholder
 * substitution. A template would therefore have to be created per unit and would drift the
 * moment somebody is appointed.
 */
export interface ResponseRoutePresetInput {
  /** The head's POSITION, not their org unit: a vacant head must fail the dry-run loudly
   *  rather than produce a step that expands to every member of the unit. */
  headPositionId: string | null;
  /** Extra approvers, all in one parallel group — sequencing them is the builder's job. */
  approverIds: readonly string[];
  /** Who signs; falls back to the head's position when a person is not named. */
  signerId: string | null;
  /** The chancellery unit that registers. */
  registryOrgUnitId: string | null;
  /** SLA per step, in hours; omitted leaves the step без срока (a legitimate case). */
  approvalHours?: number | null;
  signHours?: number | null;
}

const APPROVE_ORDER = 1;
const EXTRA_APPROVE_ORDER = 2;
const SIGN_ORDER = 3;
const REGISTER_ORDER = 4;

/**
 * Compose the preset. Throws when neither a head position nor an explicit signer is known:
 * a route whose signature step reaches nobody would strand the answer at the last step,
 * which is exactly the failure этап 1D exists to prevent.
 */
export function buildResponseRoutePreset(input: ResponseRoutePresetInput): RouteStepInput[] {
  const steps: RouteStepInput[] = [];
  const dueApproval = input.approvalHours ?? null;

  if (input.headPositionId) {
    steps.push({
      order: APPROVE_ORDER,
      kind: 'approve',
      assigneeType: 'position',
      assigneeId: input.headPositionId,
      dueHours: dueApproval,
    });
  }

  // De-duplicated: naming the same approver twice would demand two approvals from one
  // person, and the second one can never arrive.
  for (const approverId of [...new Set(input.approverIds)]) {
    steps.push({
      order: EXTRA_APPROVE_ORDER,
      kind: 'approve',
      assigneeType: 'user',
      assigneeId: approverId,
      dueHours: dueApproval,
    });
  }

  if (input.signerId) {
    steps.push({
      order: SIGN_ORDER,
      kind: 'sign',
      assigneeType: 'user',
      assigneeId: input.signerId,
      dueHours: input.signHours ?? null,
    });
  } else if (input.headPositionId) {
    steps.push({
      order: SIGN_ORDER,
      kind: 'sign',
      assigneeType: 'position',
      assigneeId: input.headPositionId,
      dueHours: input.signHours ?? null,
    });
  } else {
    throw AppException.unprocessable(
      'docflow.response.no_signer',
      'Name a signer: the preparing unit has no head to sign the answer',
    );
  }

  if (input.registryOrgUnitId) {
    steps.push({
      order: REGISTER_ORDER,
      kind: 'register',
      assigneeType: 'org_unit',
      assigneeId: input.registryOrgUnitId,
      dueHours: null,
    });
  }

  return steps;
}
