import { describe, expect, it } from 'vitest';
import {
  createSavedIncidentFilterSchema,
  incidentRegistryFilterSchema,
  listIncidentsQuerySchema,
} from './incidents';

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
