import { describe, expect, it } from 'vitest';
import {
  isSelectableIncidentType,
  mergeReportSnapshot,
  nextIncidentNumber,
  planIncidentStatusChange,
} from './incidents.service';

describe('incident registry business rules', () => {
  it('creates a per-year padded human incident number', () => {
    expect(nextIncidentNumber(2026, 0)).toBe('ЧС-2026-0001');
    expect(nextIncidentNumber(2026, 41)).toBe('ЧС-2026-0042');
  });

  it('carries forward every unmodified report figure into the immutable snapshot', () => {
    const snapshot = mergeReportSnapshot(
      {
        dead: 1,
        injured: 2,
        evacuated: 3,
        affected: 4,
        damageEst: '1200.50',
        damageNote: 'Initial estimate',
      },
      { text: 'Updated casualties', injured: 5 },
    );

    expect(snapshot).toEqual({
      dead: 1,
      injured: 5,
      evacuated: 3,
      affected: 4,
      damageEst: '1200.50',
      damageNote: 'Initial estimate',
    });
  });

  it('accepts active leaf types and rejects a category with child types', () => {
    expect(isSelectableIncidentType({ code: 'nat.hydro.flood' }, undefined)).toBe(true);
    expect(isSelectableIncidentType({ code: 'nat.hydro' }, { code: 'nat.hydro.flood' })).toBe(
      false,
    );
    expect(isSelectableIncidentType(undefined, undefined)).toBe(false);
  });
});

describe('incident status service policy', () => {
  const actorId = '01900000-0000-7000-8000-000000000001';
  const changedAt = new Date('2026-07-14T12:34:56.000Z');

  it.each([
    {
      name: 'rejects a stale persisted status',
      current: 'active' as const,
      input: { expectedStatus: 'reported' as const, status: 'localized' as const },
      code: 'incidents.status.stale',
      status: 409,
      details: { expectedStatus: 'reported', actualStatus: 'active' },
    },
    {
      name: 'rejects an unchanged status',
      current: 'active' as const,
      input: { expectedStatus: 'active' as const, status: 'active' as const },
      code: 'incidents.status.unchanged',
      status: 409,
      details: undefined,
    },
    {
      name: 'rejects a skipped forward status',
      current: 'reported' as const,
      input: { expectedStatus: 'reported' as const, status: 'localized' as const },
      code: 'incidents.status.invalid_transition',
      status: 422,
      details: { fromStatus: 'reported', toStatus: 'localized' },
    },
    {
      name: 'requires a non-blank rollback reason',
      current: 'localized' as const,
      input: { expectedStatus: 'localized' as const, status: 'active' as const, reason: '   ' },
      code: 'incidents.status.rollback_reason_required',
      status: 422,
      details: undefined,
    },
  ])('$name', ({ current, input, code, status, details }) => {
    try {
      planIncidentStatusChange(current, input, actorId, changedAt);
      expect.unreachable('expected lifecycle policy to reject the command');
    } catch (error) {
      expect(error).toMatchObject({ code, details });
      expect((error as { getStatus: () => number }).getStatus()).toBe(status);
    }
  });

  it('sets closure fields and audit meta when the final status is reached', () => {
    expect(
      planIncidentStatusChange(
        'eliminated',
        { expectedStatus: 'eliminated', status: 'closed' },
        actorId,
        changedAt,
      ),
    ).toEqual({
      patch: { status: 'closed', closedAt: changedAt, closedBy: actorId, updatedAt: changedAt },
      transition: 'forward',
      auditMeta: {
        fromStatus: 'eliminated',
        toStatus: 'closed',
        reason: null,
        rollback: false,
      },
    });
  });

  it('clears closure fields and retains the reason when a closed incident is reopened', () => {
    expect(
      planIncidentStatusChange(
        'closed',
        { expectedStatus: 'closed', status: 'active', reason: 'Response resumed' },
        actorId,
        changedAt,
      ),
    ).toEqual({
      patch: { status: 'active', closedAt: null, closedBy: null, updatedAt: changedAt },
      transition: 'rollback',
      auditMeta: {
        fromStatus: 'closed',
        toStatus: 'active',
        reason: 'Response resumed',
        rollback: true,
      },
    });
  });
});
