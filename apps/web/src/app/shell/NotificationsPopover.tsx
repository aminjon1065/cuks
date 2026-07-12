import { useTranslation } from 'react-i18next';
import { Bell, BellOff } from 'lucide-react';
import { Button, Popover, PopoverContent, PopoverTrigger } from '@cuks/ui';

/**
 * Notifications bell (docs/06 §3). Skeleton for phase 0.8 — the real feed, unread
 * badge and "mark all read" arrive with the notifications core (phase 0.10).
 */
export function NotificationsPopover(): React.JSX.Element {
  const { t } = useTranslation('nav');
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('notifications.label')}>
          <Bell className="size-[18px]" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="border-b border-border px-3 py-2 text-[13px] font-medium text-text">
          {t('notifications.label')}
        </div>
        <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
          <BellOff className="size-6 text-text-muted" />
          <span className="text-[13px] text-text-muted">{t('notifications.empty')}</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
