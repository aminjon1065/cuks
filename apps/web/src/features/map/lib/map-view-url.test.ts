import { describe, expect, it } from 'vitest';
import {
  coalesceMapFilters,
  mapViewShareUrl,
  mergeLayerStates,
  parseMapViewSearchParams,
  writeMapViewSearchParams,
  type MapViewSnapshot,
} from './map-view-url';
import type { IncidentFilterState } from './incident-filters';

const sample: MapViewSnapshot = {
  version: 1,
  mode: 'duty',
  basemap: 'light',
  camera: { center: [68.78, 38.56], zoom: 8.5 },
  layers: {
    incidents: { visible: true, opacity: 1 },
    facilities: { visible: false, opacity: 0.5 },
  },
  filters: {
    typeCode: 'flood',
    status: 'open',
    regionId: 'reg-1',
    dateFrom: '2026-06-01',
    dateTo: '2026-07-28',
    cursorDate: '2026-07-28',
  },
};

describe('writeMapViewSearchParams / parseMapViewSearchParams', () => {
  it('round-trips a full snapshot', () => {
    const params = writeMapViewSearchParams(new URLSearchParams('export=abc'), sample);
    expect(params.get('export')).toBe('abc');
    expect(params.get('view')).toBe('1');
    expect(params.get('mode')).toBe('duty');
    expect(params.get('basemap')).toBe('light');
    expect(params.get('c')).toBe('68.78000,38.56000');
    expect(params.get('z')).toBe('8.5');
    expect(params.get('status')).toBe('open');
    expect(params.get('type')).toBe('flood');
    expect(params.get('layers')).toContain('facilities:0:50');

    const parsed = parseMapViewSearchParams(params);
    expect(parsed).not.toBeNull();
    expect(parsed!.mode).toBe('duty');
    expect(parsed!.camera).toEqual({ center: [68.78, 38.56], zoom: 8.5 });
    expect(parsed!.layers.facilities).toEqual({ visible: false, opacity: 0.5 });
    expect(parsed!.filters.status).toBe('open');
    expect(parsed!.filters.typeCode).toBe('flood');
  });

  it('returns null without view=1', () => {
    expect(parseMapViewSearchParams(new URLSearchParams('mode=duty&c=1,2&z=5'))).toBeNull();
  });

  it('rejects out-of-range camera', () => {
    const params = writeMapViewSearchParams(new URLSearchParams(), sample);
    params.set('c', '200,38');
    expect(parseMapViewSearchParams(params)).toBeNull();
  });
});

describe('coalesceMapFilters', () => {
  const defaults: IncidentFilterState = {
    typeCode: '',
    status: 'open',
    regionId: '',
    dateFrom: '2026-06-29',
    dateTo: '2026-07-28',
    cursorDate: '2026-07-28',
  };

  it('keeps mode defaults when filter keys are absent', () => {
    const coalesced = coalesceMapFilters(
      {
        typeCode: '',
        status: undefined,
        regionId: '',
        dateFrom: null,
        dateTo: null,
        cursorDate: null,
      },
      defaults,
    );
    expect(coalesced).toEqual(defaults);
  });

  it('honours an explicit empty status (all statuses)', () => {
    expect(
      coalesceMapFilters(
        {
          typeCode: '',
          status: '',
          regionId: '',
          dateFrom: null,
          dateTo: null,
          cursorDate: null,
        },
        defaults,
      ).status,
    ).toBe('');
  });
});

describe('mergeLayerStates / mapViewShareUrl', () => {
  it('overlays shared toggles', () => {
    expect(
      mergeLayerStates(
        { incidents: { visible: true, opacity: 1 } },
        { facilities: { visible: true, opacity: 0.8 } },
      ),
    ).toEqual({
      incidents: { visible: true, opacity: 1 },
      facilities: { visible: true, opacity: 0.8 },
    });
  });

  it('builds an absolute permalink', () => {
    const url = mapViewShareUrl(sample, new URLSearchParams(), {
      origin: 'https://cuks.local',
      pathname: '/app/map',
    });
    expect(url.startsWith('https://cuks.local/app/map?')).toBe(true);
    expect(url).toContain('view=1');
    expect(url).toContain('mode=duty');
  });
});
