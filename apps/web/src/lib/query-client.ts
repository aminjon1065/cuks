import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api-client';

/**
 * Shared TanStack Query client. Auth failures (401/403) must not be retried —
 * they mean "log in" or "not allowed", not "try again".
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => {
          if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
            return false;
          }
          return failureCount < 2;
        },
        refetchOnWindowFocus: false,
      },
      mutations: { retry: false },
    },
  });
}
