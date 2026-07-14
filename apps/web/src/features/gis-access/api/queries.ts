import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { CreateGisDbAccountInput, GisDbAccountDto, GisDbAccountSecretDto } from '@cuks/shared';
import { api } from '@/lib/api-client';

const accountsKey = ['gis-db-accounts'] as const;

/** Issued PostGIS access accounts (docs/modules/10 §7, task 2.9). */
export function useGisDbAccounts(): UseQueryResult<GisDbAccountDto[]> {
  return useQuery({
    queryKey: accountsKey,
    queryFn: () => api.get<GisDbAccountDto[]>('/v1/admin/gis/db-accounts'),
  });
}

/** Create an account; the response carries the one-time password. */
export function useCreateGisDbAccount(): UseMutationResult<
  GisDbAccountSecretDto,
  Error,
  CreateGisDbAccountInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateGisDbAccountInput) =>
      api.post<GisDbAccountSecretDto>('/v1/admin/gis/db-accounts', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountsKey }),
  });
}

export function useDeleteGisDbAccount(): UseMutationResult<{ ok: true }, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete<{ ok: true }>(`/v1/admin/gis/db-accounts/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountsKey }),
  });
}
