import { describe, expect, it } from 'vitest';
import { buildStyle, hasBasemap } from './basemap';
import { defaultLayerStates } from './layers';

const token = (name: string): string => `color(${name})`;
const states = defaultLayerStates();
const GIS_SOURCES = ['admin_units', 'facilities', 'risk_zones', 'layer_features', 'incidents_mvt'];

describe('hasBasemap', () => {
  it('is true only when the region source is published', () => {
    expect(hasBasemap(new Set([...GIS_SOURCES, 'region']))).toBe(true);
    expect(hasBasemap(new Set(GIS_SOURCES))).toBe(false);
    expect(hasBasemap(null)).toBe(false);
  });
});

describe('buildStyle — neutral basemap (no PMTiles)', () => {
  const style = buildStyle({
    flavor: 'light',
    token,
    states,
    availableSources: new Set(GIS_SOURCES),
  });

  it('is a valid v8 style with a token-colored background and no glyphs', () => {
    expect(style.version).toBe(8);
    const background = style.layers.find((l) => l.id === 'background');
    expect(background?.type).toBe('background');
    expect(style.glyphs).toBeUndefined();
  });

  it('publishes the available gis sources but not the basemap', () => {
    expect(Object.keys(style.sources).sort()).toEqual([...GIS_SOURCES].sort());
    expect(style.sources.protomaps).toBeUndefined();
  });

  it('includes compiled gis layers on top of the background', () => {
    expect(style.layers.some((l) => l.id === 'admin_units')).toBe(true);
    expect(style.layers.some((l) => l.id === 'facilities')).toBe(true);
    expect(style.layers.some((l) => l.id === 'incidents')).toBe(true);
  });

  it('places the filter query only on the incident source', () => {
    const filtered = buildStyle({
      flavor: 'light',
      token,
      states,
      availableSources: new Set(GIS_SOURCES),
      incidentTileQuery: 'status=active&from=1&to=2',
    });
    const source = filtered.sources.incidents_mvt;
    expect(source).toMatchObject({
      type: 'vector',
      tiles: ['/tiles/incidents_mvt/{z}/{x}/{y}?status=active&from=1&to=2'],
    });
    expect(filtered.sources.admin_units).toMatchObject({
      tiles: ['/tiles/admin_units/{z}/{x}/{y}'],
    });
  });
});

describe('buildStyle — Protomaps basemap (region present)', () => {
  const withBasemap = buildStyle({
    flavor: 'dark',
    token,
    states,
    availableSources: new Set([...GIS_SOURCES, 'region']),
  });

  it('adds the protomaps source, glyphs, and cartographic layers', () => {
    expect(withBasemap.sources.protomaps).toBeDefined();
    expect(withBasemap.glyphs).toBeTruthy();
    expect(withBasemap.layers.some((l) => 'source' in l && l.source === 'protomaps')).toBe(true);
  });

  it('has strictly more layers than the neutral style', () => {
    const neutral = buildStyle({
      flavor: 'dark',
      token,
      states,
      availableSources: new Set(GIS_SOURCES),
    });
    expect(withBasemap.layers.length).toBeGreaterThan(neutral.layers.length);
  });

  it('does not duplicate the background layer id (Protomaps emits its own)', () => {
    const ids = withBasemap.layers.map((l) => l.id);
    expect(ids.filter((id) => id === 'background')).toHaveLength(1);
    expect(new Set(ids).size).toBe(ids.length);
    expect(withBasemap.layers.some((l) => l.type === 'background')).toBe(true);
  });
});

describe('buildStyle — source availability', () => {
  it('omits layers whose source is not in the catalog', () => {
    const style = buildStyle({
      flavor: 'light',
      token,
      states,
      availableSources: new Set(['admin_units']),
    });
    expect(Object.keys(style.sources)).toEqual(['admin_units']);
    expect(style.layers.some((l) => l.id === 'facilities')).toBe(false);
    expect(style.layers.some((l) => l.id === 'admin_units')).toBe(true);
  });
});
