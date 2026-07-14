import { describe, expect, it } from 'vitest';
import {
  createGisFeatureSchema,
  createGisLayerSchema,
  geoJsonGeometrySchema,
  gisFeaturesQuerySchema,
  patchGisFeatureSchema,
} from './gis';

const LAYER_ID = '019f61ed-ac29-75c4-9eff-571b9a5777a4';

const square = [
  [
    [68.75, 38.53],
    [68.83, 38.53],
    [68.83, 38.59],
    [68.75, 38.53],
  ],
];

describe('geoJsonGeometrySchema', () => {
  it('accepts the geometries terra-draw produces', () => {
    expect(
      geoJsonGeometrySchema.safeParse({ type: 'Point', coordinates: [68.8, 38.5] }).success,
    ).toBe(true);
    expect(
      geoJsonGeometrySchema.safeParse({
        type: 'LineString',
        coordinates: [
          [68.8, 38.5],
          [68.9, 38.6],
        ],
      }).success,
    ).toBe(true);
    expect(geoJsonGeometrySchema.safeParse({ type: 'Polygon', coordinates: square }).success).toBe(
      true,
    );
  });

  it('rejects a 3D coordinate — the geometry columns are 2D, and the DB would 500', () => {
    const result = geoJsonGeometrySchema.safeParse({
      type: 'Point',
      coordinates: [68.78, 38.55, 900],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unclosed ring rather than letting PostGIS silently close it', () => {
    const open = [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
    ];
    expect(geoJsonGeometrySchema.safeParse({ type: 'Polygon', coordinates: open }).success).toBe(
      false,
    );
  });

  it('rejects out-of-range and degenerate shapes', () => {
    expect(
      geoJsonGeometrySchema.safeParse({ type: 'Point', coordinates: [200, 38.5] }).success,
    ).toBe(false);
    expect(
      geoJsonGeometrySchema.safeParse({ type: 'LineString', coordinates: [[68.8, 38.5]] }).success,
    ).toBe(false);
    expect(
      geoJsonGeometrySchema.safeParse({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 1],
          ],
        ],
      }).success,
    ).toBe(false);
    expect(geoJsonGeometrySchema.safeParse({ type: 'Circle', coordinates: [0, 0] }).success).toBe(
      false,
    );
  });
});

describe('createGisLayerSchema', () => {
  it('defaults to a mixed-geometry layer with an empty style', () => {
    const parsed = createGisLayerSchema.parse({ title: '  Оцепление  ' });
    expect(parsed).toMatchObject({ title: 'Оцепление', geometryType: 'Geometry', style: {} });
  });

  it('requires a title and a known geometry type', () => {
    expect(createGisLayerSchema.safeParse({ title: '   ' }).success).toBe(false);
    expect(createGisLayerSchema.safeParse({ title: 'Слой', geometryType: 'Circle' }).success).toBe(
      false,
    );
  });
});

describe('createGisFeatureSchema / patchGisFeatureSchema', () => {
  it('requires a layer and a geometry', () => {
    expect(
      createGisFeatureSchema.safeParse({
        layerId: LAYER_ID,
        geometry: { type: 'Polygon', coordinates: square },
      }).success,
    ).toBe(true);
    expect(
      createGisFeatureSchema.safeParse({ layerId: 'not-a-uuid', geometry: null }).success,
    ).toBe(false);
  });

  it('rejects an empty patch — it would audit a no-op edit', () => {
    expect(patchGisFeatureSchema.safeParse({}).success).toBe(false);
    expect(patchGisFeatureSchema.safeParse({ props: { note: 'зона' } }).success).toBe(true);
  });
});

describe('gisFeaturesQuerySchema', () => {
  it('parses the viewport bbox and caps the page size', () => {
    const parsed = gisFeaturesQuerySchema.parse({ layerId: LAYER_ID, bbox: '68,38,69,39' });
    expect(parsed).toMatchObject({ bbox: '68,38,69,39', limit: 500 });
    expect(gisFeaturesQuerySchema.safeParse({ layerId: LAYER_ID, limit: '5000' }).success).toBe(
      false,
    );
    expect(gisFeaturesQuerySchema.safeParse({ layerId: LAYER_ID, bbox: '68,38' }).success).toBe(
      false,
    );
  });
});
