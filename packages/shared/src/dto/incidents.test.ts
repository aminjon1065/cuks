import { describe, expect, it } from 'vitest';
import {
  changeIncidentStatusSchema,
  createSavedIncidentFilterSchema,
  incidentRegistryFilterSchema,
  listIncidentsQuerySchema,
} from './incidents';
import { availableIncidentStatusTargets, incidentStatusTransition } from '../enums/index';

const inverseRange = {
  from: '2026-07-15T00:00:00.000Z',
  to: '2026-07-14T00:00:00.000Z',
};

describe('incident registry filter validation', () => {
  it('rejects an inverse date range for export, saved filters and list queries', () => {
    expect(incidentRegistryFilterSchema.safeParse(inverseRange).success).toBe(false);
    expect(
      createSavedIncidentFilterSchema.safeParse({ name: 'Inverse range', params: inverseRange })
        .success,
    ).toBe(false);
    expect(
      listIncidentsQuerySchema.safeParse({ page: 1, limit: 25, ...inverseRange }).success,
    ).toBe(false);
  });

  it('accepts a bounded range whose endpoints are equal', () => {
    expect(
      incidentRegistryFilterSchema.safeParse({
        from: '2026-07-14T00:00:00.000Z',
        to: '2026-07-14T00:00:00.000Z',
      }).success,
    ).toBe(true);
  });
});

describe('incident status lifecycle', () => {
  it('allows one step forward and a reasoned rollback to any earlier status', () => {
    expect(incidentStatusTransition('reported', 'active')).toBe('forward');
    expect(incidentStatusTransition('closed', 'active')).toBe('rollback');
    expect(
      changeIncidentStatusSchema.safeParse({
        expectedStatus: 'closed',
        status: 'active',
        reason: 'Additional response work is required',
      }).success,
    ).toBe(true);
  });

  it('rejects skipped forward steps, no-op transitions and rollback without a reason', () => {
    expect(incidentStatusTransition('reported', 'localized')).toBe('invalid');
    expect(incidentStatusTransition('active', 'active')).toBe('invalid');
    expect(
      changeIncidentStatusSchema.safeParse({ expectedStatus: 'localized', status: 'reported' })
        .success,
    ).toBe(false);
  });

  it('exposes only the next and earlier statuses to the dialog', () => {
    expect(availableIncidentStatusTargets('localized')).toEqual([
      'reported',
      'active',
      'eliminated',
    ]);
    expect(availableIncidentStatusTargets('closed')).toEqual([
      'reported',
      'active',
      'localized',
      'eliminated',
    ]);
  });
});
