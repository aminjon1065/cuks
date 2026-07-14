import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  TILE_TOKEN_TTL_SECONDS,
  type CreateGisFeatureInput,
  type CreateGisLayerInput,
  type GisFeatureDto,
  type GisLayerDto,
  type IncidentMapFilterOptionsResponse,
  type PatchGisFeatureInput,
  type TileTokenResponse,
} from '@cuks/shared';
import { api } from '@/lib/api-client';
import { appendTileToken } from '../lib/tiles';

/** One key namespace for the map feature. */
export const mapKey = ['map'] as const;
const layersKey = [...mapKey, 'layers'] as const;

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

/** Dictionary/admin-boundary options for the operational incident filters. */
export function useIncidentMapFilterOptions(): UseQueryResult<IncidentMapFilterOptionsResponse> {
  return useQuery({
    queryKey: [...mapKey, 'incident-filter-options'],
    queryFn: () => api.get<IncidentMapFilterOptionsResponse>('/v1/gis/incidents/filter-options'),
    staleTime: 30 * 60 * 1000,
  });
}

// --- Drawn layers and their features (docs/modules/10 §4, task 2.7) ---

/** The layer registry. Readable by anyone with `gis.view`; each entry carries
 *  the caller's own `canEdit`/`canManage` (server-resolved per-layer ACL). */
export function useGisLayers(): UseQueryResult<GisLayerDto[]> {
  return useQuery({
    queryKey: layersKey,
    queryFn: () => api.get<GisLayerDto[]>('/v1/gis/layers'),
    staleTime: 60 * 1000,
  });
}

export function useCreateGisLayer(): UseMutationResult<GisLayerDto, Error, CreateGisLayerInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGisLayerInput) => api.post<GisLayerDto>('/v1/gis/layers', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: layersKey }),
  });
}

export function useDeleteGisLayer(): UseMutationResult<{ ok: true }, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/v1/gis/layers/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: layersKey }),
  });
}

/** Features of a drawn layer. Fetched on demand (zoom-to-layer, geometry editing)
 *  rather than held in cache — the map renders them from vector tiles. The server
 *  pages the result (default 500, max 1000), so the caller passes what it needs. */
export function fetchGisFeatures(layerId: string, limit?: number): Promise<GisFeatureDto[]> {
  const query = new URLSearchParams({ layerId });
  if (limit !== undefined) query.set('limit', String(limit));
  return api.get<GisFeatureDto[]>(`/v1/gis/features?${query.toString()}`);
}

export function fetchGisFeature(id: string): Promise<GisFeatureDto> {
  return api.get<GisFeatureDto>(`/v1/gis/features/${id}`);
}

export function useCreateGisFeature(): UseMutationResult<
  GisFeatureDto,
  Error,
  CreateGisFeatureInput
> {
  return useMutation({
    mutationFn: (input: CreateGisFeatureInput) =>
      api.post<GisFeatureDto>('/v1/gis/features', input),
  });
}

export function usePatchGisFeature(): UseMutationResult<
  GisFeatureDto,
  Error,
  { id: string; input: PatchGisFeatureInput }
> {
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PatchGisFeatureInput }) =>
      api.patch<GisFeatureDto>(`/v1/gis/features/${id}`, input),
  });
}

export function useDeleteGisFeature(): UseMutationResult<{ ok: true }, Error, string> {
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/v1/gis/features/${id}`),
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
