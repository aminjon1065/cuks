import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Phone, PhoneOff, Video } from 'lucide-react';
import type { WsEventPayloads } from '@cuks/shared';
import { Button, Dialog, DialogContent, DialogTitle } from '@cuks/ui';
import { useSocketEvent } from '@/lib/socket';
import { useRingActions } from '../api/queries';
import { useRingtone } from '../hooks/useRingtone';

type IncomingRing = WsEventPayloads['meet.ring'];

/** The global incoming 1:1 call prompt (docs/modules/14 §2): mounted once in the app shell, it listens
 *  for `meet.ring`, plays the ringtone, and offers accept/decline. Auto-dismisses when the ring is
 *  cancelled (declined elsewhere / caller hung up / timed out). */
export function IncomingCallDialog(): React.JSX.Element | null {
  const { t } = useTranslation('meet');
  const navigate = useNavigate();
  const actions = useRingActions();
  const [ring, setRing] = useState<IncomingRing | null>(null);

  const onRing = useCallback((payload: IncomingRing) => setRing(payload), []);
  const onCancelled = useCallback(
    (payload: WsEventPayloads['meet.ring.cancelled']) =>
      setRing((cur) => (cur && cur.roomId === payload.roomId ? null : cur)),
    [],
  );
  useSocketEvent('meet.ring', onRing);
  useSocketEvent('meet.ring.cancelled', onCancelled);
  useRingtone(ring !== null);

  // Safety net: dismiss a little after the server's 30 s «no answer» window.
  useEffect(() => {
    if (!ring) return;
    const timer = window.setTimeout(() => setRing(null), 35_000);
    return () => window.clearTimeout(timer);
  }, [ring]);

  if (!ring) return null;

  const accept = (): void => {
    const current = ring;
    setRing(null);
    actions.accept.mutate(current.roomId, {
      onSuccess: () => navigate(`/app/meet/r/${current.slug}`),
    });
  };
  const decline = (): void => {
    const current = ring;
    setRing(null);
    actions.decline.mutate(current.roomId);
  };

  const Icon = ring.media === 'video' ? Video : Phone;

  return (
    <Dialog open onOpenChange={(open) => !open && decline()}>
      <DialogContent className="max-w-xs">
        <div className="flex flex-col items-center gap-4 py-2 text-center">
          <div className="flex size-14 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Icon className="size-6" />
          </div>
          <div className="space-y-1">
            <DialogTitle>{ring.fromName}</DialogTitle>
            <p className="text-[13px] text-text-muted">
              {ring.media === 'video' ? t('incoming.video') : t('incoming.audio')}
            </p>
          </div>
          <div className="flex w-full gap-2">
            <Button variant="danger" className="flex-1 gap-2" onClick={decline}>
              <PhoneOff className="size-4" />
              {t('incoming.decline')}
            </Button>
            <Button className="flex-1 gap-2" onClick={accept}>
              <Phone className="size-4" />
              {t('incoming.accept')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
