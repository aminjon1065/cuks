import { describe, expect, it } from 'vitest';
import {
  addCalendarDays,
  buildIncidentTileQuery,
  calendarDaysBetween,
  defaultIncidentFilters,
  dushanbeDayStartEpoch,
  todayInDushanbe,
} from './incident-filters';

describe('incident timeline dates', () => {
  it('uses Asia/Dushanbe for today and the default inclusive 30-day window', () => {
    const now = new Date('2026-07-13T20:30:00Z'); // 14 July in Dushanbe
    expect(todayInDushanbe(now)).toBe('2026-07-14');
    expect(defaultIncidentFilters(now)).toMatchObject({
      dateFrom: '2026-06-15',
      dateTo: '2026-07-14',
      cursorDate: '2026-07-14',
    });
  });

  it('adds calendar days and measures the inclusive slider span', () => {
    expect(addCalendarDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(calendarDaysBetween('2026-06-15', '2026-07-14')).toBe(29);
  });

  it('converts Dushanbe midnight to the correct UTC epoch', () => {
    expect(new Date(dushanbeDayStartEpoch('2026-07-14') * 1000).toISOString()).toBe(
      '2026-07-13T19:00:00.000Z',
    );
  });
});

describe('buildIncidentTileQuery', () => {
  it('serializes optional filters and an exclusive end after the playback cursor', () => {
    const query = new URLSearchParams(
      buildIncidentTileQuery({
        typeCode: 'nat.hydro.flood',
        status: 'active',
        regionId: '01900000-0000-7000-8000-000000000001',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-14',
        cursorDate: '2026-07-03',
      }),
    );
    expect(query.get('type')).toBe('nat.hydro.flood');
    expect(query.get('status')).toBe('active');
    expect(query.get('region')).toBe('01900000-0000-7000-8000-000000000001');
    expect(new Date(Number(query.get('to')) * 1000).toISOString()).toBe('2026-07-03T19:00:00.000Z');
  });

  it('keeps a one-day range exclusive end at the next local midnight', () => {
    const query = new URLSearchParams(
      buildIncidentTileQuery({
        typeCode: '',
        status: '',
        regionId: '',
        dateFrom: '2026-07-14',
        dateTo: '2026-07-14',
        cursorDate: '2026-07-14',
      }),
    );

    expect(new Date(Number(query.get('to')) * 1000).toISOString()).toBe('2026-07-14T19:00:00.000Z');
  });
});
