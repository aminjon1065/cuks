import { describe, expect, it } from 'vitest';
import { AnalyticsService } from './analytics.service';

/**
 * A db double. Every builder method returns the (thenable) builder, so awaiting at
 * any chain depth resolves to the rows chosen from the `select` projection shape.
 */
function fakeDb(data: {
  kpis: Record<string, unknown>;
  active: Record<string, unknown>[];
  activeTotal: number;
  reports: Record<string, unknown>[];
}) {
  return {
    select(shape: Record<string, unknown>) {
      const keys = Object.keys(shape);
      let rows: unknown[];
      if (keys.includes('incidentsPrev')) rows = [data.kpis];
      else if (keys.includes('longitude')) rows = data.active;
      else if (keys.length === 1 && keys[0] === 'total') rows = [{ total: data.activeTotal }];
      else if (keys.includes('incidentNumber')) rows = data.reports;
      else rows = [];
      const builder: Record<string, unknown> = {
        from: () => builder,
        innerJoin: () => builder,
        where: () => builder,
        orderBy: () => builder,
        limit: () => builder,
        then: (resolve: (value: unknown) => void) => resolve(rows),
      };
      return builder;
    },
  };
}

const KPIS_ROW = {
  incidents: 10,
  incidentsPrev: 4,
  dead: 3,
  deadPrev: 5,
  injured: 20,
  injuredPrev: 20,
  evacuated: 0,
  evacuatedPrev: 0,
  damage: '150000.00',
  damagePrev: '90000.00',
};

const QUERY = { from: '2026-07-08T00:00:00.000Z', to: '2026-07-15T00:00:00.000Z' };

describe('AnalyticsService.summary', () => {
  it('maps KPIs to value/previous, casts severity, and ISO-formats report times', async () => {
    const db = fakeDb({
      kpis: KPIS_ROW,
      active: [
        {
          id: 'i1',
          number: 'ЧС-1',
          severity: 4,
          status: 'active',
          longitude: 68.7,
          latitude: 38.5,
        },
      ],
      activeTotal: 1,
      reports: [
        {
          id: 'r1',
          incidentId: 'i1',
          reportedAt: new Date('2026-07-14T10:00:00.000Z'),
          text: 'update',
          dead: 1,
          injured: 2,
          incidentNumber: 'ЧС-1',
          typeCode: 'flood',
          severity: 4,
          status: 'active',
        },
      ],
    });
    const service = new AnalyticsService(db as never);

    const result = await service.summary(QUERY);

    expect(result.period).toEqual(QUERY);
    expect(result.kpis.incidents).toEqual({ value: 10, previous: 4 });
    expect(result.kpis.dead).toEqual({ value: 3, previous: 5 });
    // Money stays a numeric string, never a float.
    expect(result.kpis.damage).toEqual({ value: '150000.00', previous: '90000.00' });
    expect(result.activeIncidents.total).toBe(1);
    expect(result.activeIncidents.truncated).toBe(false);
    expect(result.activeIncidents.points[0]).toMatchObject({ id: 'i1', severity: 4 });
    expect(result.latestReports[0]).toMatchObject({
      id: 'r1',
      incidentNumber: 'ЧС-1',
      reportedAt: '2026-07-14T10:00:00.000Z',
    });
  });

  it('flags a capped active-incidents list and reports the true total', async () => {
    // One more than the cap (300) so the fetch of limit+1 detects truncation.
    const many = Array.from({ length: 301 }, (_, i) => ({
      id: `i${i}`,
      number: `ЧС-${i}`,
      severity: 3,
      status: 'active',
      longitude: 69,
      latitude: 38.5,
    }));
    const db = fakeDb({ kpis: KPIS_ROW, active: many, activeTotal: 512, reports: [] });
    const service = new AnalyticsService(db as never);

    const result = await service.summary(QUERY);

    expect(result.activeIncidents.points).toHaveLength(300);
    expect(result.activeIncidents.truncated).toBe(true);
    expect(result.activeIncidents.total).toBe(512);
  });
});
