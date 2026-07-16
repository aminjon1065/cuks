import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSocketEvent } from '@/lib/socket';
import { cardActivityKey, cardCommentsKey, cardKey } from '../api/queries';

/**
 * Keep the open card SidePanel live (docs/modules/15 §4). The board room broadcasts
 * `tasks.card.updated`/`moved` on every card change; the card detail / comments / activity queries
 * live under their own keys, so refetch them when an event targets THIS card.
 */
export function useCardRealtime(cardId: string): void {
  const qc = useQueryClient();
  const invalidate = useCallback(
    (payload: { taskId: string }) => {
      if (payload.taskId !== cardId) return;
      void qc.invalidateQueries({ queryKey: cardKey(cardId) });
      void qc.invalidateQueries({ queryKey: cardCommentsKey(cardId) });
      void qc.invalidateQueries({ queryKey: cardActivityKey(cardId) });
    },
    [qc, cardId],
  );
  useSocketEvent('tasks.card.updated', invalidate);
  useSocketEvent('tasks.card.moved', invalidate);
}
