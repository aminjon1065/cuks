/**
 * Map constants and helpers (docs/modules/10 §4, docs/06 §6). The explorer is
 * centred on Tajikistan; vector layers come from Martin through the same-origin
 * `/tiles` proxy (Vite in dev, Caddy in prod — docs/modules/10 §9).
 */

/** Approximate geographic extent of Tajikistan `[west, south, east, north]`.
 *  Used as the initial view and the zoom-to-layer fallback when a source has no
 *  usable bounds (e.g. an empty table). */
export const TAJIKISTAN_BOUNDS: [number, number, number, number] = [67.3, 36.6, 75.2, 41.1];

/** Initial camera: whole-country overview. */
export const INITIAL_CENTER: [number, number] = [71.3, 38.6];
export const INITIAL_ZOOM = 6;

/** Martin source name of the PMTiles basemap (`infra/basemap/region.pmtiles`,
 *  built by `infra/scripts/build-basemap.sh`). Absent in dev → neutral basemap. */
export const BASEMAP_SOURCE = 'region';

/** Tile-URL template for a Martin source, resolved same-origin. The tile token
 *  is appended per-request by {@link makeTransformRequest}, not baked in here. */
export function tileUrl(source: string, query = ''): string {
  return `/tiles/${source}/{z}/{x}/{y}${query ? `?${query}` : ''}`;
}

/** Read a design-system color token (docs/06 §2) off the document root so map
 *  layers follow the active light/dark theme. `fallback` keeps SSR/tests safe. */
export type TokenResolver = (name: string) => string;

export function cssToken(name: string, fallback = '#000000'): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}
