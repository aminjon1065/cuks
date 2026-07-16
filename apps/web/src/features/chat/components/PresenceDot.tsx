import { useTranslation } from 'react-i18next';
import { cn } from '@cuks/ui';
import type { PresenceStatus } from '@cuks/shared';

/** Status dot on an avatar corner (docs/modules/13 §4): green online, amber away, nothing offline.
 *  Place inside a `relative` wrapper around the Avatar. */
export function PresenceDot({
  status,
}: {
  status: PresenceStatus | undefined;
}): React.JSX.Element | null {
  const { t } = useTranslation('chat');
  if (!status || status === 'offline') return null;
  return (
    <span
      title={status === 'online' ? t('presence.online') : t('presence.away')}
      className={cn(
        'absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-surface',
        status === 'online' ? 'bg-success' : 'bg-warning',
      )}
    />
  );
}
