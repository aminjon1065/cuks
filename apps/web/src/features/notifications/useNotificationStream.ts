import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@cuks/ui';
import type { WsEventPayloads } from '@cuks/shared';
import { useSocketEvent } from '@/lib/socket';
import { notificationsKey } from './api/queries';

/**
 * Live notifications (docs/04 §Frontend): on a `notify.new` socket event, refetch
 * the feed + unread count (no parallel store) and raise a toast. Mount once inside
 * the authenticated shell.
 */
export function useNotificationStream(): void {
  const qc = useQueryClient();
  const { t } = useTranslation('notifications');

  const onNew = useCallback(
    (_payload: WsEventPayloads['notify.new']) => {
      void qc.invalidateQueries({ queryKey: notificationsKey });
      toast({ title: t('toast.new') });
    },
    [qc, t],
  );

  useSocketEvent('notify.new', onNew);
}
