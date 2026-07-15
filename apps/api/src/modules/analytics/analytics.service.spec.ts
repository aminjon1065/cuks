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

/** A db double for the six grouped stats queries, keyed by the select projection. */
function fakeStatsDb(data: {
  totals: Record<string, unknown>;
  byMonth: unknown[];
  byType: unknown[];
  byRegion: unknown[];
  heatmap: unknown[];
  casualties: unknown[];
  regions: unknown[];
}) {
  return {
    select(shape: Record<string, unknown>) {
      const keys = Object.keys(shape);
      let rows: unknown[];
      if (keys.includes('geojson')) rows = data.regions;
      else if (keys.includes('incidents')) rows = [data.totals];
      else if (keys.includes('month')) rows = data.byMonth;
      else if (keys.includes('dow')) rows = data.heatmap;
      else if (keys.includes('regionName')) rows = data.byRegion;
      else if (keys.includes('evacuated')) rows = data.casualties;
      else if (keys.includes('typeCode')) rows = data.byType;
      else rows = [];
      const builder: Record<string, unknown> = {
        from: () => builder,
        leftJoin: () => builder,
        where: () => builder,
        groupBy: () => builder,
        orderBy: () => builder,
        limit: () => builder,
        then: (resolve: (value: unknown) => void) => resolve(rows),
      };
      return builder;
    },
  };
}

const EMPTY_STATS = {
  totals: { incidents: 0, dead: 0, injured: 0, evacuated: 0, damage: '0.00' },
  byMonth: [],
  byType: [],
  byRegion: [],
  heatmap: [],
  casualties: [],
  regions: [],
};

describe('AnalyticsService.stats', () => {
  it('echoes the filters and returns each grouped dataset', async () => {
    const db = fakeStatsDb({
      totals: { incidents: 10, dead: 2, injured: 5, evacuated: 1, damage: '1000.00' },
      byMonth: [{ month: '2026-06', count: 4, dead: 1, injured: 2, damage: '500.00' }],
      byType: [{ typeCode: 'flood', typeName: 'Наводнение', count: 6 }],
      byRegion: [{ regionId: 'r1', regionName: 'Душанбе', count: 8 }],
      heatmap: [{ dow: 2, hour: 15, count: 3 }],
      casualties: [
        {
          typeCode: 'flood',
          typeName: 'Наводнение',
          dead: 2,
          injured: 5,
          evacuated: 1,
          damage: '1000.00',
        },
      ],
      regions: [],
    });
    const service = new AnalyticsService(db as never);

    const result = await service.stats({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
      regionId: 'r1',
      typeCode: 'flood',
    });

    expect(result.filters).toEqual({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
      regionId: 'r1',
      typeCode: 'flood',
    });
    expect(result.totals.incidents).toBe(10);
    expect(result.byMonth[0]?.month).toBe('2026-06');
    expect(result.byType[0]?.typeName).toBe('Наводнение');
    expect(result.byRegion[0]?.regionName).toBe('Душанбе');
    expect(result.heatmap[0]).toEqual({ dow: 2, hour: 15, count: 3 });
    expect(result.casualtiesByType[0]?.evacuated).toBe(1);
  });

  it('nulls the optional filters when they are absent', async () => {
    const service = new AnalyticsService(fakeStatsDb(EMPTY_STATS) as never);
    const result = await service.stats({
      from: '2026-01-01T00:00:00.000Z',
      to: '2026-08-01T00:00:00.000Z',
    });
    expect(result.filters.regionId).toBeNull();
    expect(result.filters.typeCode).toBeNull();
  });

  it('regionsGeoJson parses geometry into a FeatureCollection', async () => {
    const db = fakeStatsDb({
      ...EMPTY_STATS,
      regions: [
        {
          id: 'r1',
          code: 'TJ-DU',
          name: 'Душанбе',
          geojson: '{"type":"MultiPolygon","coordinates":[]}',
        },
      ],
    });
    const service = new AnalyticsService(db as never);

    const geo = await service.regionsGeoJson();

    expect(geo.type).toBe('FeatureCollection');
    expect(geo.features[0]).toMatchObject({
      type: 'Feature',
      id: 'r1',
      properties: { code: 'TJ-DU', name: 'Душанбе' },
    });
    expect((geo.features[0]?.geometry as { type: string }).type).toBe('MultiPolygon');
  });
});
