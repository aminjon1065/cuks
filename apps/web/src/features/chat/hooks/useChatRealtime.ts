import { useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WsEventPayloads } from '@cuks/shared';
import { useSocket, useSocketEvent } from '@/lib/socket';
import { channelKey, channelsKey, messagesKey } from '../api/queries';

/**
 * Subscribe to a chat channel's `channel:{id}` room and refresh on live updates (docs/modules/13 §5).
 * Like {@link useBoardRealtime}, the subscription is re-issued on every socket (re)connect — server
 * rooms are per physical connection, so a reconnect would otherwise drop this socket from the room.
 * Every event (including the actor's own) invalidates: react-query dedupes, and keying a skip on the
 * user id would wrongly drop updates in the same user's other tabs. The optimistic sender's list is
 * already reconciled by id, so the extra refetch is harmless.
 */
export function useChatRealtime(channelId: string | undefined): void {
  const { socket } = useSocket();
  const qc = useQueryClient();

  useEffect(() => {
    if (!socket || !channelId) return;
    // channel.subscribe/unsubscribe are client→server messages, outside the server-event map.
    const emit = (socket as unknown as { emit: (e: string, p: unknown) => void }).emit.bind(socket);
    const subscribe = (): void => emit('channel.subscribe', { channelId });
    subscribe();
    socket.on('connect', subscribe);
    return () => {
      socket.off('connect', subscribe);
      emit('channel.unsubscribe', { channelId });
    };
  }, [socket, channelId]);

  const onMessage = useCallback(
    (payload: WsEventPayloads['chat.message.created']) => {
      if (payload.channelId !== channelId) return;
      void qc.invalidateQueries({ queryKey: messagesKey(payload.channelId) });
      void qc.invalidateQueries({ queryKey: channelsKey });
    },
    [qc, channelId],
  );

  const onChannelUpdated = useCallback(
    (payload: WsEventPayloads['chat.channel.updated']) => {
      void qc.invalidateQueries({ queryKey: channelKey(payload.channelId) });
      void qc.invalidateQueries({ queryKey: channelsKey });
    },
    [qc],
  );

  useSocketEvent('chat.message.created', onMessage);
  useSocketEvent('chat.channel.updated', onChannelUpdated);
}
