import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Bell, BellOff } from 'lucide-react';
import { Button, Popover, PopoverContent, PopoverTrigger, Skeleton, cn } from '@cuks/ui';
import type { MeResponse, NotificationDto } from '@cuks/shared';
import {
  useMarkAllRead,
  useMarkRead,
  useNotifications,
  useUnreadCount,
} from '@/features/notifications/api/queries';
import {
  formatRelativeTime,
  groupIcon,
  notificationHref,
  notificationText,
} from '@/features/notifications/lib';

function FeedRow({ n, me, onClick }: { n: NotificationDto; me: MeResponse; onClick: () => void }) {
  const { t } = useTranslation('notifications');
  const text = notificationText(t, n);
  const Icon = groupIcon(n.group);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-surface-2',
        !n.isRead && 'bg-primary/[0.04]',
      )}
    >
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-muted [&_svg]:size-4">
        <Icon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-text">{text.title}</span>
          {!n.isRead ? <span className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}
        </span>
        <span className="mt-0.5 line-clamp-2 block text-xs text-text-muted">{text.body}</span>
        <span className="mt-1 block text-[11px] text-text-muted">
          {formatRelativeTime(n.createdAt, me.locale, Date.now())}
        </span>
      </span>
    </button>
  );
}

export function NotificationsPopover({ me }: { me: MeResponse }): React.JSX.Element {
  const { t } = useTranslation('notifications');
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const unread = useUnreadCount();
  const feed = useNotifications({ limit: 8 });
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  const count = unread.data ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t('bell.title')} className="relative">
          <Bell className="size-[18px]" />
          {count > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white">
              {count > 99 ? '99+' : count}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-[13px] font-medium text-text">{t('bell.title')}</span>
          {count > 0 ? (
            <button
              type="button"
              onClick={() => markAllRead.mutate()}
              className="text-xs text-primary hover:underline"
            >
              {t('bell.markAllRead')}
            </button>
          ) : null}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {feed.isLoading ? (
            <div className="space-y-3 p-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex gap-2.5">
                  <Skeleton className="size-7 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-2/3" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                </div>
              ))}
            </div>
          ) : feed.isError ? (
            <div className="px-3 py-8 text-center text-[13px] text-text-muted">
              {t('bell.error')}
            </div>
          ) : (feed.data?.items.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <BellOff className="size-6 text-text-muted" />
              <span className="text-[13px] text-text-muted">{t('bell.empty')}</span>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {feed.data?.items.map((n) => (
                <li key={n.id}>
                  <FeedRow
                    n={n}
                    me={me}
                    onClick={() => {
                      if (!n.isRead) markRead.mutate(n.id);
                      const href = notificationHref(n);
                      if (href) {
                        setOpen(false);
                        navigate(href);
                      }
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-border p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() => {
              setOpen(false);
              navigate('/app/notifications');
            }}
          >
            {t('bell.viewAll')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
