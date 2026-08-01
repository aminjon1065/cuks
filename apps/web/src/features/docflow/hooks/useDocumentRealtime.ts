import { useCallback, useEffect } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useSocket, useSocketEvent } from '@/lib/socket';
import { documentsKey } from '../api/queries';

/**
 * The queue-shaped views: the register list, the cabinet badges and «Требует внимания».
 *
 * Invalidated on ANY docflow event, whatever document it concerned, because that is exactly
 * what changes them — a pre-execution gate opening somewhere puts an instruction into MY «Мои
 * поручения» without touching any card I have open.
 *
 * React Query matches by key PREFIX, and each of these is a distinct prefix: `[…, 'list', …]`,
 * `[…, 'queue-counts']`, `[…, 'attention']`. Invalidating the card's key — `[…, documentId]` —
 * matched none of them, so no realtime event had ever refreshed a queue. That is the defect
 * this file was rewritten for, and the old comment claimed the opposite.
 */
function invalidateQueues(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: [...documentsKey, 'list'] });
  void qc.invalidateQueries({ queryKey: [...documentsKey, 'queue-counts'] });
  void qc.invalidateQueries({ queryKey: [...documentsKey, 'attention'] });
}

/**
 * Keep the queues in step with what happens elsewhere in the register (docs/modules/11 §12.11).
 *
 * Mounted once in the shell rather than on a page: an instruction becomes visible when its
 * gate opens, and the person it lands on is by definition NOT looking at that document — they
 * are looking at their own list. A hook that only ran on an open card could never deliver
 * that, however correct its invalidation was.
 */
export function useDocflowQueuesRealtime(): void {
  const qc = useQueryClient();
  const refresh = useCallback(() => invalidateQueues(qc), [qc]);

  useSocketEvent('docflow.route.updated', refresh);
  useSocketEvent('docflow.resolution.updated', refresh);
  useSocketEvent('docflow.dispatch.updated', refresh);
  useSocketEvent('docflow.distribution.updated', refresh);
}

/**
 * Keep an open document card in step with what others do to it (docs/modules/11 §12.9).
 *
 * Subscribing is server-gated on the document's visibility, so the room cannot become a side
 * channel around the document policy; the event carries only ids, and the card refetches
 * through the normal API.
 *
 * Two things this hook is careful about.
 *
 * **It checks WHICH document the event was about.** The same socket also receives events
 * through the viewer's own `user:{id}` room, so without the check an open card refetched
 * itself every time anything moved anywhere in the register.
 *
 * **It catches up after a reconnect.** Re-joining the room only restores FUTURE events;
 * whatever happened while the transport was down was never delivered, and would sit stale
 * behind a 30-second `staleTime` with `refetchOnWindowFocus` off.
 */
export function useDocumentRealtime(documentId: string | null): void {
  const { socket } = useSocket();
  const qc = useQueryClient();

  const invalidateCard = useCallback(() => {
    if (!documentId) return;
    void qc.invalidateQueries({ queryKey: [...documentsKey, documentId] });
  }, [qc, documentId]);

  useEffect(() => {
    if (!socket || !documentId) return;
    // subscribe/unsubscribe are client→server messages, outside the server-event map.
    const emit = (socket as unknown as { emit: (e: string, p: unknown) => void }).emit.bind(socket);
    const subscribe = (): void => emit('document.subscribe', { documentId });
    subscribe();
    const onConnect = (): void => {
      // The room membership lives on the socket, not the user, so it must be re-joined —
      // and everything missed while it was down must be refetched.
      subscribe();
      invalidateCard();
      invalidateQueues(qc);
    };
    socket.on('connect', onConnect);
    return () => {
      socket.off('connect', onConnect);
      emit('document.unsubscribe', { documentId });
    };
  }, [socket, documentId, invalidateCard, qc]);

  const onEvent = useCallback(
    (payload: { documentId: string }) => {
      if (payload.documentId !== documentId) return;
      invalidateCard();
    },
    [documentId, invalidateCard],
  );

  useSocketEvent('docflow.route.updated', onEvent);
  useSocketEvent('docflow.resolution.updated', onEvent);
  useSocketEvent('docflow.dispatch.updated', onEvent);
  useSocketEvent('docflow.distribution.updated', onEvent);
}
