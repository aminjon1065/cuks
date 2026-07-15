import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  ReportExportInput,
  ReportQuery,
  ReportResultDto,
  SavedReportDto,
  SaveReportInput,
} from '@cuks/shared';
import { api } from '@/lib/api-client';

export const reportsKey = ['reports'] as const;

/** Run the report constructor (`POST /analytics/query`). Requires `analytics.build`. */
export function useRunReport(): UseMutationResult<ReportResultDto, unknown, ReportQuery> {
  return useMutation({
    mutationFn: (query: ReportQuery) => api.post<ReportResultDto>('/v1/analytics/query', query),
  });
}

/** My saved report definitions. */
export function useSavedReports(): UseQueryResult<SavedReportDto[]> {
  return useQuery({
    queryKey: [...reportsKey, 'saved'],
    queryFn: () => api.get<SavedReportDto[]>('/v1/analytics/reports'),
  });
}

export function useSaveReport(): UseMutationResult<SavedReportDto, unknown, SaveReportInput> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: SaveReportInput) =>
      api.post<SavedReportDto>('/v1/analytics/reports', input),
    onSuccess: () => client.invalidateQueries({ queryKey: [...reportsKey, 'saved'] }),
  });
}

export function useDeleteReport(): UseMutationResult<void, unknown, string> {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<void>(`/v1/analytics/reports/${id}`),
    onSuccess: () => client.invalidateQueries({ queryKey: [...reportsKey, 'saved'] }),
  });
}

/** Download the report XLSX — CSRF-aware, same as the incident-registry export. */
export async function exportReport(input: ReportExportInput): Promise<void> {
  const csrf = readCookie('cuks_csrf');
  const response = await fetch('/api/v1/analytics/query/export', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ...(csrf ? { 'x-csrf-token': csrf } : {}),
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(`Report export failed: ${response.status}`);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = 'report.xlsx';
  link.click();
  URL.revokeObjectURL(url);
}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}
