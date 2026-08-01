import { useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocket, useSocketEvent } from '@/lib/socket';
import { boardKey } from '../api/queries';

/**
 * Subscribe to a board's `board:{projectId}` room and refetch on any change (docs/modules/15 §3).
 * The subscription is re-issued on every socket (re)connect — server rooms are per physical
 * connection, so a reconnect would otherwise drop this socket out of the board room. Every board
 * event invalidates (including the actor's own): react-query dedupes the refetch, and keying a skip
 * on the user id would wrongly drop updates in the same user's other tabs/devices.
 */
export function useBoardRealtime(projectId: string | undefined): void {
  const { socket, ready } = useSocket();
  const qc = useQueryClient();

  useEffect(() => {
    // Waits for `ready`, not `connect`: the gateway attaches the user asynchronously, and a
    // subscribe sent before that is answered `{ok:false}` — an ack nothing reads, so the board
    // would silently never join its room. `ready` flips on every reconnect, which re-joins it.
    if (!socket || !ready || !projectId) return;
    // board.subscribe/unsubscribe are client→server messages, outside the server-event map.
    const emit = (socket as unknown as { emit: (e: string, p: unknown) => void }).emit.bind(socket);
    emit('board.subscribe', { projectId });
    // Catch up on what moved while the transport was down — re-joining restores future
    // events only, and the board is exactly the screen where a missed move is confusing.
    void qc.invalidateQueries({ queryKey: boardKey(projectId) });
    return () => {
      emit('board.unsubscribe', { projectId });
    };
  }, [socket, ready, projectId, qc]);

  const invalidate = useCallback(() => {
    if (!projectId) return;
    void qc.invalidateQueries({ queryKey: boardKey(projectId) });
  }, [qc, projectId]);

  useSocketEvent('tasks.card.moved', invalidate);
  useSocketEvent('tasks.card.created', invalidate);
  useSocketEvent('tasks.card.updated', invalidate);
  useSocketEvent('tasks.board.changed', invalidate);
}
