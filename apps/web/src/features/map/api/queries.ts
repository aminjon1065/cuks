import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  TILE_TOKEN_TTL_SECONDS,
  type CreateGisExportInput,
  type CreateGisFeatureInput,
  type CreateGisImportResponse,
  type GisAccessInfoDto,
  type CreateGisLayerInput,
  type GisExportDto,
  type GisFeatureDto,
  type GisImportDto,
  type GisLayerDto,
  type IncidentMapFilterOptionsResponse,
  type IncidentScopeResponse,
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

/** The caller's incident territory scope (task 2.13). For a confined user the map
 *  defaults and locks its region filter to `regionIds` so incident tiles — which the
 *  tile-auth gate confines to those regions — resolve instead of 403-ing. */
export function useIncidentScope(): UseQueryResult<IncidentScopeResponse> {
  return useQuery({
    queryKey: [...mapKey, 'incident-scope'],
    queryFn: () => api.get<IncidentScopeResponse>('/v1/gis/incident-scope'),
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

// --- Import / export of geodata (docs/modules/10 §6, task 2.8) ---

const importsKey = [...mapKey, 'imports'] as const;
const exportsKey = [...mapKey, 'exports'] as const;

/** Poll interval while a geo job runs. The worker reports through the record, and
 *  a background job has no socket channel of its own (the worker cannot push). */
const JOB_POLL_MS = 1000;

/** Step 1+2 of the wizard: reserve the record, upload the file straight to storage
 *  with the presigned URL, then queue it. */
export function useStartGisImport(): UseMutationResult<
  GisImportDto,
  Error,
  { file: File; title?: string }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ file, title }: { file: File; title?: string }) => {
      const created = await api.post<CreateGisImportResponse>('/v1/gis/imports', {
        fileName: file.name,
        size: file.size,
        ...(title ? { title } : {}),
      });
      const uploaded = await fetch(created.uploadUrl, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: file,
      });
      if (!uploaded.ok) throw new Error(`upload failed: HTTP ${uploaded.status}`);
      return api.post<GisImportDto>(`/v1/gis/imports/${created.importId}/start`);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: importsKey }),
  });
}

/** Watch a running import; stops polling once the worker is done. */
export function useGisImport(id: string | null): UseQueryResult<GisImportDto> {
  return useQuery({
    queryKey: [...importsKey, id],
    queryFn: () => api.get<GisImportDto>(`/v1/gis/imports/${id!}`),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'done' || status === 'failed' ? false : JOB_POLL_MS;
    },
  });
}

export function useCreateGisExport(): UseMutationResult<GisExportDto, Error, CreateGisExportInput> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGisExportInput) => api.post<GisExportDto>('/v1/gis/exports', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: exportsKey }),
  });
}

export function useGisExport(id: string | null): UseQueryResult<GisExportDto> {
  return useQuery({
    queryKey: [...exportsKey, id],
    queryFn: () => api.get<GisExportDto>(`/v1/gis/exports/${id!}`),
    enabled: !!id,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'done' || status === 'failed' ? false : JOB_POLL_MS;
    },
  });
}

/** Presigned download of a finished export (short-lived, `attachment`). */
export function fetchGisExportUrl(id: string): Promise<{ url: string }> {
  return api.get<{ url: string }>(`/v1/gis/exports/${id}/download`);
}

// --- QGIS/ArcGIS integration: publication + access info (docs/modules/10 §7, 2.9) ---

/** Connection details for the «Для ГИС-специалистов» page. */
export function useGisAccessInfo(): UseQueryResult<GisAccessInfoDto> {
  return useQuery({
    queryKey: [...mapKey, 'access-info'],
    queryFn: () => api.get<GisAccessInfoDto>('/v1/gis/access-info'),
    staleTime: 10 * 60 * 1000,
  });
}

export function usePublishLayer(): UseMutationResult<GisLayerDto, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<GisLayerDto>(`/v1/gis/layers/${id}/publish`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: layersKey }),
  });
}

export function useUnpublishLayer(): UseMutationResult<GisLayerDto, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<GisLayerDto>(`/v1/gis/layers/${id}/unpublish`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: layersKey }),
  });
}
