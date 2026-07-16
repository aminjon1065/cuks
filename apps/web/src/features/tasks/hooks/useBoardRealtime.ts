import { useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocket, useSocketEvent } from '@/lib/socket';
import { boardKey } from '../api/queries';

/**
 * Subscribe to a board's `board:{projectId}` room and refetch on another user's change
 * (docs/modules/15 §3). The actor's own events are ignored — their mutation already updated the
 * cache, and refetching would fight the optimistic move.
 */
export function useBoardRealtime(projectId: string | undefined, myId: string | undefined): void {
  const { socket } = useSocket();
  const qc = useQueryClient();

  useEffect(() => {
    if (!socket || !projectId) return;
    // board.subscribe/unsubscribe are client→server messages, outside the server-event map.
    const emit = (socket as unknown as { emit: (e: string, p: unknown) => void }).emit.bind(socket);
    emit('board.subscribe', { projectId });
    return () => {
      emit('board.unsubscribe', { projectId });
    };
  }, [socket, projectId]);

  const invalidate = useCallback(
    (payload: { actorId: string }) => {
      if (payload.actorId === myId || !projectId) return;
      void qc.invalidateQueries({ queryKey: boardKey(projectId) });
    },
    [qc, projectId, myId],
  );

  useSocketEvent('tasks.card.moved', invalidate);
  useSocketEvent('tasks.card.created', invalidate);
  useSocketEvent('tasks.card.updated', invalidate);
  useSocketEvent('tasks.board.changed', invalidate);
}
