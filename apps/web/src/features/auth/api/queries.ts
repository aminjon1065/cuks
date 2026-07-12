import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query';
import type { ChangePasswordInput, LoginInput, MeResponse } from '@cuks/shared';
import { api } from '@/lib/api-client';

export const meKey = ['auth', 'me'] as const;

/** Current session/profile (docs/05). 401 → not authenticated (surfaced as error). */
export function useMe(): UseQueryResult<MeResponse> {
  return useQuery({
    queryKey: meKey,
    queryFn: () => api.get<MeResponse>('/auth/me'),
    staleTime: 60_000,
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) =>
      api.post<{ mustChangePassword: boolean }>('/auth/login', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: meKey }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>('/auth/logout'),
    onSuccess: () => qc.clear(),
  });
}

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ChangePasswordInput) => api.post<{ ok: true }>('/auth/password', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: meKey }),
  });
}

/**
 * Enrollment secret. Modelled as a query (not a mutation) so it is fetched once on
 * mount and cached — a StrictMode remount would otherwise drop a mutation's data.
 * The server stores the returned secret as the pending one, so re-reads stay
 * consistent; `refetchOnMount` is off to avoid minting a fresh secret on revisits.
 */
export function useTotpSetup(): UseQueryResult<{ secret: string; otpauthUrl: string }> {
  return useQuery({
    queryKey: ['auth', 'totp', 'setup'],
    queryFn: () => api.post<{ secret: string; otpauthUrl: string }>('/auth/totp/setup'),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
  });
}

export function useTotpConfirm(): UseMutationResult<{ backupCodes: string[] }, Error, string> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      api.post<{ backupCodes: string[] }>('/auth/totp/confirm', { code }),
    onSuccess: () => qc.invalidateQueries({ queryKey: meKey }),
  });
}
