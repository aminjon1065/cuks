import { useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { WsEventPayloads } from '@cuks/shared';
import { useSocket, useSocketEvent } from '@/lib/socket';
import { channelKey, channelsKey, messagesKey, pinsKey, unreadTotalsKey } from '../api/queries';

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
    // On every (re)connect, re-join the room AND refetch — a socket blip can drop live events, so we
    // reconcile the last page + unread counts on reconnect (docs/modules/13 §5). The refetch replaces
    // the message cache wholesale, so it can never leave a duplicate of an optimistic/echoed message.
    const onConnect = (): void => {
      subscribe();
      void qc.invalidateQueries({ queryKey: messagesKey(channelId) });
      void qc.invalidateQueries({ queryKey: channelsKey });
      void qc.invalidateQueries({ queryKey: unreadTotalsKey });
    };
    socket.on('connect', onConnect);
    return () => {
      socket.off('connect', onConnect);
      emit('channel.unsubscribe', { channelId });
    };
  }, [socket, channelId, qc]);

  const onMessage = useCallback(
    (payload: WsEventPayloads['chat.message.created']) => {
      if (payload.channelId !== channelId) return;
      void qc.invalidateQueries({ queryKey: messagesKey(payload.channelId) });
      void qc.invalidateQueries({ queryKey: channelsKey });
      void qc.invalidateQueries({ queryKey: unreadTotalsKey });
    },
    [qc, channelId],
  );

  const onChannelUpdated = useCallback(
    (payload: WsEventPayloads['chat.channel.updated']) => {
      void qc.invalidateQueries({ queryKey: channelKey(payload.channelId) });
      void qc.invalidateQueries({ queryKey: channelsKey });
      void qc.invalidateQueries({ queryKey: pinsKey(payload.channelId) });
    },
    [qc],
  );

  // Edits, deletes and reactions all refresh the open channel's feed.
  const onMessageChanged = useCallback(
    (payload: { channelId: string; messageId: string; actorId: string }) => {
      if (payload.channelId !== channelId) return;
      void qc.invalidateQueries({ queryKey: messagesKey(payload.channelId) });
    },
    [qc, channelId],
  );

  useSocketEvent('chat.message.created', onMessage);
  useSocketEvent('chat.channel.updated', onChannelUpdated);
  useSocketEvent('chat.message.updated', onMessageChanged);
  useSocketEvent('chat.message.deleted', onMessageChanged);
  useSocketEvent('chat.reaction.updated', onMessageChanged);
}
