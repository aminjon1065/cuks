import { describe, expect, it } from 'vitest';
import type { GeoJsonGeometry } from '@cuks/shared';
import { geometriesBounds, sameGeometry } from './geo';

describe('geometriesBounds', () => {
  it('covers every coordinate of a mixed set of geometries', () => {
    const geometries: GeoJsonGeometry[] = [
      { type: 'Point', coordinates: [68.8, 38.5] },
      {
        type: 'Polygon',
        coordinates: [
          [
            [69.1, 38.4],
            [69.4, 38.4],
            [69.4, 38.9],
            [69.1, 38.9],
            [69.1, 38.4],
          ],
        ],
      },
    ];
    expect(geometriesBounds(geometries)).toEqual([68.8, 38.4, 69.4, 38.9]);
  });

  it('handles a multi-part geometry through its nesting', () => {
    const multi: GeoJsonGeometry = {
      type: 'MultiLineString',
      coordinates: [
        [
          [67.5, 37.1],
          [68, 37.5],
        ],
        [
          [70, 40],
          [71.2, 40.6],
        ],
      ],
    };
    expect(geometriesBounds([multi])).toEqual([67.5, 37.1, 71.2, 40.6]);
  });

  it('returns null for an empty layer, so the caller can say so instead of zooming to 0,0', () => {
    expect(geometriesBounds([])).toBeNull();
  });
});

describe('sameGeometry', () => {
  const polygon: GeoJsonGeometry = {
    type: 'Polygon',
    coordinates: [
      [
        [68.75, 38.53],
        [68.83, 38.53],
        [68.83, 38.59],
        [68.75, 38.53],
      ],
    ],
  };

  it('treats a selected-but-unmoved feature as unchanged (terra-draw re-emits it)', () => {
    expect(sameGeometry(polygon, structuredClone(polygon))).toBe(true);
  });

  it('ignores rounding below a centimetre', () => {
    const rounded = structuredClone(polygon);
    rounded.coordinates[0]![0]![0] = 68.750000001;
    expect(sameGeometry(polygon, rounded)).toBe(true);
  });

  it('sees a dragged vertex', () => {
    const moved = structuredClone(polygon);
    moved.coordinates[0]![0]![0] = 68.7;
    expect(sameGeometry(polygon, moved)).toBe(false);
  });

  it('sees a changed geometry type or vertex count', () => {
    expect(sameGeometry(polygon, { type: 'Point', coordinates: [68.75, 38.53] })).toBe(false);
    const extra = structuredClone(polygon);
    extra.coordinates[0]!.push([68.76, 38.54]);
    expect(sameGeometry(polygon, extra)).toBe(false);
  });

  it('is false when either side is missing', () => {
    expect(sameGeometry(null, polygon)).toBe(false);
    expect(sameGeometry(polygon, null)).toBe(false);
  });
});
