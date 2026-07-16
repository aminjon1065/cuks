import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseQueryResult,
} from '@tanstack/react-query';
import type {
  AddChannelMemberInput,
  ChannelDto,
  ChannelListItemDto,
  ChatUnreadTotalsDto,
  CreateChannelInput,
  CreateDmInput,
  DirectoryUserDto,
  MessageDto,
  MessagesPage,
  SendMessageInput,
  UpdateChannelInput,
  UpdateMembershipInput,
} from '@cuks/shared';
import { api } from '@/lib/api-client';

export const chatKey = ['chat'] as const;
export const channelsKey = [...chatKey, 'channels'] as const;
export const catalogKey = [...chatKey, 'catalog'] as const;
export const unreadTotalsKey = [...chatKey, 'unread-totals'] as const;
export const channelKey = (id: string) => [...channelsKey, id] as const;
export const messagesKey = (channelId: string) => [...channelsKey, channelId, 'messages'] as const;

export function useMyChannels(): UseQueryResult<ChannelListItemDto[]> {
  return useQuery({
    queryKey: channelsKey,
    queryFn: () => api.get<ChannelListItemDto[]>('/v1/chat/channels'),
  });
}

export function useCatalog(enabled = true): UseQueryResult<ChannelListItemDto[]> {
  return useQuery({
    queryKey: catalogKey,
    queryFn: () => api.get<ChannelListItemDto[]>('/v1/chat/channels/catalog'),
    enabled,
  });
}

export function useChannel(channelId: string | undefined): UseQueryResult<ChannelDto> {
  return useQuery({
    queryKey: channelKey(channelId ?? ''),
    queryFn: () => api.get<ChannelDto>(`/v1/chat/channels/${channelId}`),
    enabled: !!channelId,
  });
}

/** Cursor-paged message history (docs/modules/13 §5) — newest first, load older upward. */
export function useMessages(channelId: string | undefined) {
  return useInfiniteQuery({
    queryKey: messagesKey(channelId ?? ''),
    queryFn: ({ pageParam }) =>
      api.get<MessagesPage>(
        `/v1/chat/channels/${channelId}/messages${pageParam ? `?cursor=${pageParam}` : ''}`,
      ),
    initialPageParam: '' as string,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!channelId,
  });
}

/** Send a message optimistically (docs/modules/13 §5): it shows immediately with a temp id, then
 *  reconciles to the server row on success (or rolls back on error). */
export function useSendMessage(channelId: string, me: { id: string; name: string | null }) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SendMessageInput) =>
      api.post<MessageDto>(`/v1/chat/channels/${channelId}/messages`, body),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: messagesKey(channelId) });
      const tempId = `temp-${crypto.randomUUID()}`;
      const optimistic: MessageDto = {
        id: tempId,
        channelId,
        authorId: me.id,
        authorName: me.name,
        kind: body.kind ?? 'text',
        body: body.body ?? null,
        bodyText: null,
        replyToId: body.replyToId ?? null,
        fileIds: body.fileIds ?? [],
        createdAt: new Date().toISOString(),
        editedAt: null,
        deletedAt: null,
      };
      qc.setQueryData<InfiniteData<MessagesPage>>(messagesKey(channelId), (old) =>
        prependMessage(old, optimistic),
      );
      return { tempId };
    },
    onSuccess: (message, _body, ctx) => {
      // Swap the temp message for the server row (reconcile by temp id).
      qc.setQueryData<InfiniteData<MessagesPage>>(messagesKey(channelId), (old) =>
        replaceMessage(old, ctx?.tempId, message),
      );
      void qc.invalidateQueries({ queryKey: channelsKey });
    },
    onError: (_e, _body, ctx) => {
      // Drop only the failed optimistic row — never restore a pre-send snapshot, which would also wipe
      // any peer messages that arrived (via realtime refetch) while this send was in flight — then
      // reconcile with the server.
      qc.setQueryData<InfiniteData<MessagesPage>>(messagesKey(channelId), (old) =>
        removeMessage(old, ctx?.tempId),
      );
      void qc.invalidateQueries({ queryKey: messagesKey(channelId) });
    },
  });
}

export function useCreateChannel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateChannelInput) => api.post<ChannelDto>('/v1/chat/channels', body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: channelsKey });
      void qc.invalidateQueries({ queryKey: catalogKey });
    },
  });
}

export function useCreateDm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDmInput) => api.post<ChannelDto>('/v1/chat/channels/dm', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelsKey }),
  });
}

/** Add a member, or join a public channel (userId = me). */
export function useAddMember(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddChannelMemberInput) =>
      api.post<ChannelDto>(`/v1/chat/channels/${channelId}/members`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: channelKey(channelId) });
      void qc.invalidateQueries({ queryKey: channelsKey });
      void qc.invalidateQueries({ queryKey: catalogKey });
    },
  });
}

/** Remove a member, or leave the channel (userId = me). */
export function useRemoveMember(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => api.delete(`/v1/chat/channels/${channelId}/members/${userId}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: channelKey(channelId) });
      void qc.invalidateQueries({ queryKey: channelsKey });
    },
  });
}

export function useUpdateChannel(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateChannelInput) =>
      api.patch<ChannelDto>(`/v1/chat/channels/${channelId}`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: channelKey(channelId) });
      void qc.invalidateQueries({ queryKey: channelsKey });
    },
  });
}

export function useUpdateMembership(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMembershipInput) =>
      api.patch(`/v1/chat/channels/${channelId}/membership`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: channelsKey }),
  });
}

/** People directory for the DM / add-member pickers (task 1.5 `/directory/users`). */
export function useDirectoryUsers(search: string): UseQueryResult<DirectoryUserDto[]> {
  const q = search.trim();
  return useQuery({
    queryKey: ['directory', 'users', q],
    queryFn: () =>
      api.get<DirectoryUserDto[]>(`/v1/directory/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  });
}

/** Mark the channel read up to a message — refreshes the unread badges. */
export function useMarkRead(channelId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) =>
      api.post(`/v1/chat/channels/${channelId}/read`, { messageId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: channelsKey });
      void qc.invalidateQueries({ queryKey: unreadTotalsKey });
    },
  });
}

/** Sidebar totals — unread + mentions across all conversations (docs/modules/13 §4). Message events
 *  only reach subscribed (open) channel rooms, so cross-channel badge freshness rides on this 60s
 *  interval until 5.7 adds per-user notification events (decision in docs/plan/STATUS.md). */
export function useUnreadTotals(): UseQueryResult<ChatUnreadTotalsDto> {
  return useQuery({
    queryKey: unreadTotalsKey,
    queryFn: () => api.get<ChatUnreadTotalsDto>('/v1/chat/channels/unread-count'),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// --- infinite-cache helpers ---

function prependMessage(
  data: InfiniteData<MessagesPage> | undefined,
  message: MessageDto,
): InfiniteData<MessagesPage> {
  if (!data || data.pages.length === 0) {
    return { pages: [{ items: [message], nextCursor: null }], pageParams: [''] };
  }
  const [first, ...rest] = data.pages;
  return {
    ...data,
    pages: [{ ...first!, items: [message, ...first!.items] }, ...rest],
  };
}

function replaceMessage(
  data: InfiniteData<MessagesPage> | undefined,
  tempId: string | undefined,
  message: MessageDto,
): InfiniteData<MessagesPage> | undefined {
  if (!data || !tempId) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((m) => (m.id === tempId ? message : m)),
    })),
  };
}

function removeMessage(
  data: InfiniteData<MessagesPage> | undefined,
  tempId: string | undefined,
): InfiniteData<MessagesPage> | undefined {
  if (!data || !tempId) return data;
  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.filter((m) => m.id !== tempId),
    })),
  };
}
