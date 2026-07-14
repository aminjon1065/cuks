import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { TILE_TOKEN_TTL_SECONDS, type TileTokenResponse } from '@cuks/shared';
import { api } from '@/lib/api-client';
import { appendTileToken } from '../lib/tiles';

/** One key namespace for the map feature. */
export const mapKey = ['map'] as const;

// Refresh the tile token a few minutes before its TTL so open maps never pan
// into an expired token (docs/modules/10 §9).
const TOKEN_REFRESH_LEAD_SECONDS = 300;
const TOKEN_REFRESH_MS = Math.max(TILE_TOKEN_TTL_SECONDS - TOKEN_REFRESH_LEAD_SECONDS, 60) * 1000;

/** Fetch (and keep fresh) the short-lived tile-access token. Requires `gis.view`;
 *  a 403 here surfaces as the page's forbidden state. */
export function useTileToken(): UseQueryResult<TileTokenResponse> {
  return useQuery({
    queryKey: [...mapKey, 'tile-token'],
    queryFn: () => api.get<TileTokenResponse>('/v1/gis/tile-token'),
    staleTime: TOKEN_REFRESH_MS,
    refetchInterval: TOKEN_REFRESH_MS,
    refetchIntervalInBackground: true,
  });
}

interface MartinCatalog {
  tiles?: Record<string, unknown>;
}

/** Probe Martin's catalog (through the `/tiles` proxy) for the source ids that
 *  are actually published — drives which layers appear and whether the Protomaps
 *  basemap is available (`region`). `/tiles/catalog` sits behind the same Caddy
 *  `forward_auth` as every other `/tiles/*` request, so it must carry the tile
 *  token; the query stays disabled until the token is available. */
export function useMartinCatalog(
  token: string | null | undefined,
): UseQueryResult<ReadonlySet<string>> {
  return useQuery({
    queryKey: [...mapKey, 'catalog'],
    queryFn: async (): Promise<ReadonlySet<string>> => {
      const res = await fetch(appendTileToken('/tiles/catalog', token), {
        headers: { Accept: 'application/json' },
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`martin catalog: HTTP ${res.status}`);
      const body = (await res.json()) as MartinCatalog;
      return new Set(Object.keys(body.tiles ?? {}));
    },
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
  });
}
