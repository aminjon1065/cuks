import type { RequestParameters, ResourceType } from 'maplibre-gl';

/**
 * Tile-token wiring (docs/modules/10 §9). Every request MapLibre makes to the
 * `/tiles` origin gets the current short-lived token appended as `?token=`, which
 * Caddy's `forward_auth` validates in prod. In dev there is no Caddy so the gate
 * is not enforced, but the token still rides along so the same code path is
 * exercised. The token is read through a getter so it can be refreshed (before
 * its 1h TTL) without rebuilding the map style.
 */

const ORIGIN =
  typeof window !== 'undefined' && window.location ? window.location.origin : 'http://localhost';

/** Resolve `url` (absolute, or relative to the app origin) to a URL, or null. */
function toUrl(url: string): URL | null {
  try {
    return new URL(url, ORIGIN);
  } catch {
    return null;
  }
}

/** True when `url`'s path targets the Martin tile proxy. */
function isTileUrl(url: string): boolean {
  return toUrl(url)?.pathname.startsWith('/tiles/') ?? false;
}

/** Return `url` with the tile token set as `?token=`, or unchanged when there is
 *  no token or the URL is not a tile URL. Pure — unit-tested. */
export function appendTileToken(url: string, token: string | null | undefined): string {
  if (!token) return url;
  const parsed = toUrl(url);
  if (!parsed || !parsed.pathname.startsWith('/tiles/')) return url;
  parsed.searchParams.set('token', token);
  return parsed.toString();
}

/**
 * Build a MapLibre `transformRequest` that stamps tile requests with the latest
 * token read from `getToken`. Non-tile requests are passed through untouched.
 */
export function makeTransformRequest(
  getToken: () => string | null | undefined,
): (url: string, resourceType?: ResourceType) => RequestParameters | undefined {
  return (url) => {
    if (!isTileUrl(url)) return undefined;
    const withToken = appendTileToken(url, getToken());
    return withToken === url ? undefined : { url: withToken };
  };
}

/** Looks like a usable, non-global bbox (a source with real data extent). */
function isUsableBounds(b: [number, number, number, number]): boolean {
  const [w, s, e, n] = b;
  if (![w, s, e, n].every(Number.isFinite)) return false;
  if (e <= w || n <= s) return false;
  // Martin returns the whole world for sources with no data extent — treat as
  // "no bounds" so callers can fall back to the country view.
  return e - w < 350 && n - s < 170;
}

interface TileJson {
  bounds?: [number, number, number, number];
}

/**
 * Fetch a Martin source's data extent from its TileJSON (`/tiles/<source>`), for
 * zoom-to-layer. Returns null when the source has no usable bounds (e.g. an empty
 * table) so the caller can fall back to the country view.
 */
export async function fetchSourceBounds(
  source: string,
  token: string | null | undefined,
): Promise<[number, number, number, number] | null> {
  const res = await fetch(appendTileToken(`/tiles/${source}`, token), {
    headers: { Accept: 'application/json' },
    credentials: 'include',
  });
  if (!res.ok) return null;
  const body = (await res.json()) as TileJson;
  const bounds = body.bounds;
  return bounds && isUsableBounds(bounds) ? bounds : null;
}
