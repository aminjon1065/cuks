/**
 * Coordinate / place-query helpers for the map search box (docs/modules/10 §4).
 * Named places are resolved by the API; coordinates are parsed on the client so
 * a paste of "38.56, 68.78" works offline of the search index.
 */

export type ParsedCoordinates = {
  /** WGS84 longitude. */
  lon: number;
  /** WGS84 latitude. */
  lat: number;
};

/** Tajikistan + margin — used to decide lat,lon vs lon,lat when ambiguous. */
const TJ = { minLon: 66.5, maxLon: 76.0, minLat: 36.0, maxLat: 41.5 };

function inRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

/**
 * Parse a free-text coordinate pair. Accepts `lat, lon`, `lon, lat`, spaces,
 * and optional N/S/E/W letters. Returns null when the text is not coordinates.
 */
export function parseCoordinates(raw: string): ParsedCoordinates | null {
  const text = raw.trim();
  if (!text) return null;

  // "38.56° N, 68.78° E" / "N38.56 E68.78" / "38.56, 68.78"
  const hems = text.match(
    /^\s*([NS])?\s*(-?\d+(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;\s]\s*([EW])?\s*(-?\d+(?:\.\d+)?)\s*°?\s*([EW])?\s*$/i,
  );
  if (!hems) {
    const plain = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!plain) return null;
    return orient(Number(plain[1]), Number(plain[2]));
  }

  let a = Number(hems[2]);
  let b = Number(hems[5]);
  const ns = (hems[1] ?? hems[3] ?? '').toUpperCase();
  const ew = (hems[4] ?? hems[6] ?? '').toUpperCase();
  if (ns === 'S') a = -Math.abs(a);
  if (ns === 'N') a = Math.abs(a);
  if (ew === 'W') b = -Math.abs(b);
  if (ew === 'E') b = Math.abs(b);

  // Hemisphere letters force the axis order: first number is lat, second is lon.
  if (ns || ew) {
    if (!inRange(a, -90, 90) || !inRange(b, -180, 180)) return null;
    return { lat: a, lon: b };
  }
  return orient(a, b);
}

/** Prefer the orientation that lands inside Tajikistan; else classic lat,lon. */
function orient(first: number, second: number): ParsedCoordinates | null {
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null;

  const asLatLon =
    inRange(first, -90, 90) && inRange(second, -180, 180) ? { lat: first, lon: second } : null;
  const asLonLat =
    inRange(first, -180, 180) && inRange(second, -90, 90) ? { lat: second, lon: first } : null;

  if (asLatLon && inTj(asLatLon) && !(asLonLat && inTj(asLonLat))) return asLatLon;
  if (asLonLat && inTj(asLonLat) && !(asLatLon && inTj(asLatLon))) return asLonLat;
  // Both or neither in TJ: prefer lat,lon (common paste form).
  return asLatLon;
}

function inTj(point: ParsedCoordinates): boolean {
  return inRange(point.lon, TJ.minLon, TJ.maxLon) && inRange(point.lat, TJ.minLat, TJ.maxLat);
}

/** Small bounds around a point so MapLibre `fitBounds` has something to frame. */
export function pointBounds(
  lon: number,
  lat: number,
  pad = 0.05,
): [number, number, number, number] {
  return [lon - pad, lat - pad, lon + pad, lat + pad];
}
