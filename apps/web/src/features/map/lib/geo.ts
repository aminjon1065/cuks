import type { GeoJsonGeometry } from '@cuks/shared';

/** `[west, south, east, north]` — the shape MapLibre's `fitBounds` accepts. */
export type Bounds = [number, number, number, number];

/** Flatten any GeoJSON coordinate nesting down to positions. */
function positions(coordinates: unknown, out: number[][]): void {
  if (!Array.isArray(coordinates)) return;
  if (typeof coordinates[0] === 'number' && typeof coordinates[1] === 'number') {
    out.push(coordinates as number[]);
    return;
  }
  for (const part of coordinates) positions(part, out);
}

/** ~1 cm at the equator: below this, two coordinates are the same point. */
const EPSILON = 1e-7;

function sameCoordinates(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < EPSILON;
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((part, index) => sameCoordinates(part, b[index]));
}

/**
 * Did the geometry actually move? Selecting a feature in the editor makes
 * terra-draw emit an update of its own, and a click that lands back on the same
 * vertex is not an edit either — without this the "save" action would light up
 * (and rewrite the geometry) when nothing had changed.
 */
export function sameGeometry(
  a: GeoJsonGeometry | null | undefined,
  b: GeoJsonGeometry | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.type === b.type && sameCoordinates(a.coordinates, b.coordinates);
}

/** Bounding box of a set of geometries — used to zoom to a drawn layer, whose
 *  features are not a Martin source of their own (they share `layer_features`,
 *  so the source's bounds would cover every layer at once). */
export function geometriesBounds(geometries: readonly GeoJsonGeometry[]): Bounds | null {
  const coords: number[][] = [];
  for (const geometry of geometries) positions(geometry.coordinates, coords);
  if (coords.length === 0) return null;

  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lon, lat] of coords) {
    if (typeof lon !== 'number' || typeof lat !== 'number') continue;
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return Number.isFinite(west) && Number.isFinite(south) ? [west, south, east, north] : null;
}
