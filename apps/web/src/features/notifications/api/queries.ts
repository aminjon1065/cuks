import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type {
  ListNotificationsQuery,
  NotificationDto,
  NotificationPrefsDto,
  NotificationPrefsUpdateInput,
  PaginatedResult,
  UnreadCountDto,
} from '@cuks/shared';
import { api } from '@/lib/api-client';

export const notificationsKey = ['notifications'] as const;
export const unreadCountKey = ['notifications', 'unread-count'] as const;
export const notificationPrefsKey = ['notifications', 'prefs'] as const;

function toQueryString(q: Partial<ListNotificationsQuery>): string {
  const params = new URLSearchParams();
  if (q.page) params.set('page', String(q.page));
  if (q.limit) params.set('limit', String(q.limit));
  if (q.unread) params.set('unread', 'true');
  if (q.group) params.set('group', q.group);
  const s = params.toString();
  return s ? `?${s}` : '';
}

export function useNotifications(
  query: Partial<ListNotificationsQuery> = {},
): UseQueryResult<PaginatedResult<NotificationDto>> {
  return useQuery({
    queryKey: [...notificationsKey, 'list', query],
    queryFn: () =>
      api.get<PaginatedResult<NotificationDto>>(`/v1/notifications${toQueryString(query)}`),
  });
}

export function useUnreadCount(): UseQueryResult<number> {
  return useQuery({
    queryKey: unreadCountKey,
    queryFn: async () => (await api.get<UnreadCountDto>('/v1/notifications/unread-count')).count,
    staleTime: 15_000,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.post<{ ok: true }>(`/v1/notifications/${id}/read`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationsKey });
    },
  });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: true }>('/v1/notifications/read-all'),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: notificationsKey });
    },
  });
}

export function useNotificationPrefs(): UseQueryResult<NotificationPrefsDto> {
  return useQuery({
    queryKey: notificationPrefsKey,
    queryFn: () => api.get<NotificationPrefsDto>('/v1/notifications/prefs'),
  });
}

export function useUpdateNotificationPrefs() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NotificationPrefsUpdateInput) =>
      api.patch<NotificationPrefsDto>('/v1/notifications/prefs', input),
    // Optimistic: flip the toggled cells immediately, roll back on error.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: notificationPrefsKey });
      const previous = qc.getQueryData<NotificationPrefsDto>(notificationPrefsKey);
      if (previous) {
        qc.setQueryData<NotificationPrefsDto>(notificationPrefsKey, {
          prefs: previous.prefs.map((p) => {
            const u = input.updates.find(
              (x) => x.typeGroup === p.typeGroup && x.channel === p.channel,
            );
            return u ? { ...p, enabled: u.enabled } : p;
          }),
        });
      }
      return { previous };
    },
    onError: (_err, _input, context) => {
      if (context?.previous) qc.setQueryData(notificationPrefsKey, context.previous);
    },
    onSuccess: (data) => {
      qc.setQueryData(notificationPrefsKey, data);
    },
  });
}
