import { useCallback, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocket, useSocketEvent } from '@/lib/socket';
import { documentsKey } from '../api/queries';

/**
 * Keep an open document card in step with what others do to it (docs/modules/11 §12.9).
 * Subscribing is server-gated on the document's visibility, so the room cannot become a
 * side channel around the document policy; the event itself carries only ids, and the card
 * refetches through the normal API.
 */
export function useDocumentRealtime(documentId: string | null): void {
  const { socket } = useSocket();
  const qc = useQueryClient();

  useEffect(() => {
    if (!socket || !documentId) return;
    // subscribe/unsubscribe are client→server messages, outside the server-event map.
    const emit = (socket as unknown as { emit: (e: string, p: unknown) => void }).emit.bind(socket);
    const subscribe = (): void => emit('document.subscribe', { documentId });
    subscribe();
    // Re-subscribe after a reconnect: the room membership lives on the socket, not the user.
    socket.on('connect', subscribe);
    return () => {
      socket.off('connect', subscribe);
      emit('document.unsubscribe', { documentId });
    };
  }, [socket, documentId]);

  const invalidate = useCallback(() => {
    if (!documentId) return;
    void qc.invalidateQueries({ queryKey: [...documentsKey, documentId] });
  }, [qc, documentId]);

  useSocketEvent('docflow.route.updated', invalidate);
  // Also fires when a gate opens — and then it reaches the executors' own rooms, whose
  // «Мои задачи» list must refresh even though no document card is open (docs/modules/11 §12.11).
  useSocketEvent('docflow.resolution.updated', invalidate);
  useSocketEvent('docflow.dispatch.updated', invalidate);
}
