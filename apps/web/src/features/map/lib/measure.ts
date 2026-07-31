import { lineString, polygon } from '@turf/helpers';
import length from '@turf/length';
import area from '@turf/area';

/** Map measure tool (docs/modules/10 §4): distance along a polyline or area of a polygon. */
export type MeasureMode = 'none' | 'distance' | 'area';

export type LngLat = [number, number];

export interface MeasureReading {
  mode: 'distance' | 'area';
  /** Geodesic length in meters (polyline, or closed-ring perimeter for area). */
  meters: number;
  /** Geodesic area in m² when the ring has ≥3 vertices; otherwise null. */
  squareMeters: number | null;
  pointCount: number;
}

/** Source / layer ids for the ephemeral measure overlay on the MapLibre style. */
export const MEASURE_SOURCE = 'cuks-measure';
export const MEASURE_LINE_LAYER = 'cuks-measure-line';
export const MEASURE_FILL_LAYER = 'cuks-measure-fill';
export const MEASURE_POINTS_LAYER = 'cuks-measure-points';

/** Geodesic length of a polyline in meters (WGS84). */
export function lineLengthMeters(points: readonly LngLat[]): number {
  if (points.length < 2) return 0;
  return length(lineString([...points]), { units: 'meters' });
}

/** Geodesic area of a ring in m². Needs ≥3 vertices; closes the ring if open. */
export function ringAreaSquareMeters(points: readonly LngLat[]): number | null {
  if (points.length < 3) return null;
  const ring = closeRing(points);
  return area(polygon([ring]));
}

export function measureReading(
  mode: 'distance' | 'area',
  points: readonly LngLat[],
): MeasureReading {
  if (mode === 'distance') {
    return {
      mode,
      meters: lineLengthMeters(points),
      squareMeters: null,
      pointCount: points.length,
    };
  }
  const closed = points.length >= 3 ? closeRing(points) : points;
  return {
    mode,
    meters: lineLengthMeters(closed),
    squareMeters: ringAreaSquareMeters(points),
    pointCount: points.length,
  };
}

/** Close a ring for GeoJSON (first == last). */
export function closeRing(points: readonly LngLat[]): LngLat[] {
  if (points.length === 0) return [];
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (first[0] === last[0] && first[1] === last[1]) return [...points];
  return [...points, first];
}

/** GeoJSON FeatureCollection for the measure sketch overlay. */
export function measureCollection(
  mode: 'distance' | 'area',
  points: readonly LngLat[],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  if (points.length >= 2) {
    if (mode === 'area' && points.length >= 3) {
      features.push({
        type: 'Feature',
        properties: { kind: 'fill' },
        geometry: { type: 'Polygon', coordinates: [closeRing(points)] },
      });
    }
    features.push({
      type: 'Feature',
      properties: { kind: 'line' },
      geometry: {
        type: 'LineString',
        coordinates: mode === 'area' && points.length >= 3 ? closeRing(points) : [...points],
      },
    });
  }
  for (const point of points) {
    features.push({
      type: 'Feature',
      properties: { kind: 'vertex' },
      geometry: { type: 'Point', coordinates: point },
    });
  }
  return { type: 'FeatureCollection', features };
}

/** Format a length for the HUD (Russian-style grouping, adaptive unit). */
export function formatDistanceMeters(
  meters: number,
  locale = 'ru-RU',
): { n: string; unit: 'm' | 'km' } {
  if (meters < 1000) {
    return {
      n: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(meters),
      unit: 'm',
    };
  }
  return {
    n: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(meters / 1000),
    unit: 'km',
  };
}

/** Format an area for the HUD: m² → ha → km². */
export function formatAreaSquareMeters(
  squareMeters: number,
  locale = 'ru-RU',
): { n: string; unit: 'm2' | 'ha' | 'km2' } {
  if (squareMeters < 10_000) {
    return {
      n: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(squareMeters),
      unit: 'm2',
    };
  }
  if (squareMeters < 1_000_000) {
    return {
      n: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(squareMeters / 10_000),
      unit: 'ha',
    };
  }
  return {
    n: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(squareMeters / 1_000_000),
    unit: 'km2',
  };
}
