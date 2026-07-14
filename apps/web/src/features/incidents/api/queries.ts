import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import {
  type CreateIncidentInput,
  type ChangeIncidentStatusInput,
  type CreateIncidentReportInput,
  type CreateIncidentResourceInput,
  type CreateSavedIncidentFilterInput,
  type IncidentDetailDto,
  type IncidentRegistryFilters,
  type IncidentMapFilterOptionsResponse,
  type ListIncidentsQuery,
  type PaginatedResult,
  type SavedIncidentFilterDto,
  type IncidentListItemDto,
} from '@cuks/shared';
import { api } from '@/lib/api-client';

export const incidentsKey = ['incidents'] as const;

function listPath(query: ListIncidentsQuery): string {
  const params = new URLSearchParams();
  params.set('page', String(query.page));
  params.set('limit', String(query.limit));
  params.set('sort', query.sort);
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.typeCode) params.set('typeCode', query.typeCode);
  if (query.severity) params.set('severity', String(query.severity));
  if (query.status) params.set('status', query.status);
  if (query.regionId) params.set('regionId', query.regionId);
  if (query.search) params.set('search', query.search);
  return `/v1/incidents?${params}`;
}

export function useIncidents(
  query: ListIncidentsQuery,
): UseQueryResult<PaginatedResult<IncidentListItemDto>> {
  return useQuery({
    queryKey: [...incidentsKey, 'list', query],
    queryFn: () => api.get<PaginatedResult<IncidentListItemDto>>(listPath(query)),
  });
}

export function useIncident(id: string | undefined): UseQueryResult<IncidentDetailDto> {
  return useQuery({
    queryKey: [...incidentsKey, 'detail', id],
    queryFn: () => api.get<IncidentDetailDto>(`/v1/incidents/${id}`),
    enabled: !!id,
  });
}

export function useIncidentOptions(): UseQueryResult<IncidentMapFilterOptionsResponse> {
  return useQuery({
    queryKey: [...incidentsKey, 'options'],
    queryFn: () => api.get<IncidentMapFilterOptionsResponse>('/v1/gis/incidents/filter-options'),
    staleTime: 30 * 60 * 1000,
  });
}

export function useSavedIncidentFilters(): UseQueryResult<SavedIncidentFilterDto[]> {
  return useQuery({
    queryKey: [...incidentsKey, 'saved-filters'],
    queryFn: () => api.get<SavedIncidentFilterDto[]>('/v1/incidents/saved-filters'),
  });
}

function invalidateIncidents(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: incidentsKey });
}

export function useCreateIncident() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateIncidentInput) => api.post<IncidentDetailDto>('/v1/incidents', input),
    onSuccess: () => invalidateIncidents(queryClient),
  });
}

export function useCreateIncidentReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateIncidentReportInput }) =>
      api.post<IncidentDetailDto>(`/v1/incidents/${id}/reports`, input),
    onSuccess: () => invalidateIncidents(queryClient),
  });
}

export function useCreateIncidentResource() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: CreateIncidentResourceInput }) =>
      api.post<IncidentDetailDto>(`/v1/incidents/${id}/resources`, input),
    onSuccess: () => invalidateIncidents(queryClient),
  });
}

export function useChangeIncidentStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: ChangeIncidentStatusInput }) =>
      api.post<IncidentDetailDto>(`/v1/incidents/${id}/status`, input),
    // A stale optimistic command (409) also needs to refresh the card.
    onSettled: () => invalidateIncidents(queryClient),
  });
}

export function useSaveIncidentFilter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateSavedIncidentFilterInput) =>
      api.post<SavedIncidentFilterDto>('/v1/incidents/saved-filters', input),
    onSuccess: () => invalidateIncidents(queryClient),
  });
}

export function useRemoveIncidentFilter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/v1/incidents/saved-filters/${id}`),
    onSuccess: () => invalidateIncidents(queryClient),
  });
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** Browser download keeps the same session/CSRF semantics as the API client. */
export async function exportIncidents(filters: IncidentRegistryFilters): Promise<void> {
  const csrf = readCookie('cuks_csrf');
  const response = await fetch('/api/v1/incidents/export', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
    },
    body: JSON.stringify(filters),
  });
  if (!response.ok) throw new Error(`Incident export failed: ${response.status}`);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = 'incidents.xlsx';
  link.click();
  URL.revokeObjectURL(url);
}
