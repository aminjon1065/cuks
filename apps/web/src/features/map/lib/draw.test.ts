import { describe, expect, it } from 'vitest';
import type { GeoJsonGeometry } from '@cuks/shared';
import type { GeoJSONStoreFeatures } from 'terra-draw';
import { editableGeometry, editModeFor, geometryOf, hexColor, terraMode, toolsFor } from './draw';

describe('toolsFor', () => {
  it('offers only the tool a single-type layer accepts', () => {
    expect(toolsFor('Point')).toEqual(['point']);
    expect(toolsFor('LineString')).toEqual(['line']);
    expect(toolsFor('Polygon')).toEqual(['polygon']);
  });

  it('offers every tool on a mixed-geometry layer', () => {
    expect(toolsFor('Geometry')).toEqual(['point', 'line', 'polygon']);
    expect(toolsFor(null)).toEqual(['point', 'line', 'polygon']);
  });
});

describe('terraMode', () => {
  it('maps the toolbar to terra-draw mode names', () => {
    expect(terraMode('line')).toBe('linestring');
    expect(terraMode('polygon')).toBe('polygon');
    expect(terraMode('select')).toBe('select');
    expect(terraMode('none')).toBe('static');
  });
});

describe('editableGeometry / editModeFor', () => {
  it('accepts the single-part geometries terra-draw can edit', () => {
    const point: GeoJsonGeometry = { type: 'Point', coordinates: [68.8, 38.5] };
    expect(editableGeometry(point)).toBe(point);
    expect(editModeFor('Point')).toBe('point');
    expect(editModeFor('LineString')).toBe('linestring');
    expect(editModeFor('Polygon')).toBe('polygon');
  });

  it('leaves multi-part geometries inspectable but not editable', () => {
    const multi: GeoJsonGeometry = {
      type: 'MultiPoint',
      coordinates: [
        [68.8, 38.5],
        [69, 39],
      ],
    };
    expect(editableGeometry(multi)).toBeNull();
    expect(editModeFor('MultiPolygon')).toBeNull();
  });
});

describe('geometryOf', () => {
  it('extracts the geometry a finished sketch carries', () => {
    const feature = {
      type: 'Feature',
      id: 'f1',
      geometry: { type: 'Point', coordinates: [68.8, 38.5] },
      properties: { mode: 'point' },
    } as unknown as GeoJSONStoreFeatures;
    expect(geometryOf(feature)).toEqual({ type: 'Point', coordinates: [68.8, 38.5] });
  });
});

describe('hexColor', () => {
  it('passes design-token hex through and falls back on anything else', () => {
    expect(hexColor('#b91c1c')).toBe('#b91c1c');
    expect(hexColor('#fff')).toBe('#fff');
    expect(hexColor('oklch(0.7 0.1 200)')).toBe('#15803d');
    expect(hexColor('', '#ffffff')).toBe('#ffffff');
  });
});
