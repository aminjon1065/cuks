import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PresenceStatus, PresenceStatusDto, WsEventPayloads } from '@cuks/shared';
import { api } from '@/lib/api-client';
import { useSocketEvent } from '@/lib/socket';

const presenceKey = ['presence'] as const;

/**
 * Presence for a set of users (docs/modules/13 §4): a bulk fetch seeds the statuses, live
 * `presence.changed` broadcasts patch every cached set, and a 60s refetch re-derives the
 * server-side away transition (idle >10 min never emits an event of its own).
 */
export function usePresence(userIds: string[]): Map<string, PresenceStatus> {
  const qc = useQueryClient();
  const ids = useMemo(() => [...new Set(userIds)].sort().slice(0, 100), [userIds]);
  const key = ids.join(',');

  const query = useQuery({
    queryKey: [...presenceKey, key],
    queryFn: () => api.get<PresenceStatusDto[]>(`/v1/presence?userIds=${key}`),
    enabled: ids.length > 0,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const onChanged = useCallback(
    (payload: WsEventPayloads['presence.changed']) => {
      qc.setQueriesData<PresenceStatusDto[]>({ queryKey: presenceKey }, (old) =>
        old?.map((s) =>
          s.userId === payload.userId
            ? { ...s, status: payload.status, activityAt: payload.activityAt }
            : s,
        ),
      );
    },
    [qc],
  );
  useSocketEvent('presence.changed', onChanged);

  return useMemo(() => new Map((query.data ?? []).map((s) => [s.userId, s.status])), [query.data]);
}
