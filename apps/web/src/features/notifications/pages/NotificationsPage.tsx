import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { BellRing, CheckCheck, ChevronLeft, ChevronRight, Settings } from 'lucide-react';
import { Button, EmptyState, PageHeader, Skeleton, Switch, cn } from '@cuks/ui';
import type { NotificationDto } from '@cuks/shared';
import { useMe } from '@/features/auth/api/queries';
import { useMarkAllRead, useMarkRead, useNotifications, useUnreadCount } from '../api/queries';
import { formatRelativeTime, groupIcon, notificationHref, notificationText } from '../lib';

const PAGE_SIZE = 20;

function Row({ n, locale, onClick }: { n: NotificationDto; locale: string; onClick: () => void }) {
  const { t } = useTranslation('notifications');
  const text = notificationText(t, n);
  const Icon = groupIcon(n.group);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-md border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-2',
        !n.isRead && 'border-primary/20 bg-primary/[0.04]',
      )}
    >
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-muted [&_svg]:size-4">
        <Icon />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-text">{text.title}</span>
          {!n.isRead ? <span className="size-1.5 shrink-0 rounded-full bg-primary" /> : null}
        </span>
        <span className="mt-0.5 block text-[13px] text-text-muted">{text.body}</span>
      </span>
      <span className="shrink-0 whitespace-nowrap text-[11px] text-text-muted">
        {formatRelativeTime(n.createdAt, locale, Date.now())}
      </span>
    </button>
  );
}

export function NotificationsPage(): React.JSX.Element {
  const { t } = useTranslation('notifications');
  const { t: tc } = useTranslation('common');
  const navigate = useNavigate();
  const me = useMe();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const query = { page, limit: PAGE_SIZE, ...(unreadOnly ? { unread: true } : {}) };
  const list = useNotifications(query);
  const unread = useUnreadCount();
  const markRead = useMarkRead();
  const markAllRead = useMarkAllRead();

  const locale = me.data?.locale ?? 'ru';
  const total = list.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title={t('page.title')}
        description={t('page.subtitle')}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate('/app/settings/notifications')}
            >
              <Settings /> {t('page.settings')}
            </Button>
            <Button
              size="sm"
              disabled={(unread.data ?? 0) === 0 || markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
            >
              <CheckCheck /> {t('page.markAllRead')}
            </Button>
          </>
        }
      />

      <label className="flex w-fit items-center gap-2 text-[13px] text-text">
        <Switch
          checked={unreadOnly}
          onCheckedChange={(v) => {
            setUnreadOnly(v);
            setPage(1);
          }}
          aria-label={t('page.filterUnread')}
        />
        {t('page.filterUnread')}
      </label>

      {list.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-16 w-full rounded-md" />
          ))}
        </div>
      ) : list.isError ? (
        <div className="rounded-md border border-border py-12 text-center text-[13px] text-text-muted">
          {t('bell.error')}
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={() => list.refetch()}>
              {tc('actions.retry')}
            </Button>
          </div>
        </div>
      ) : (list.data?.items.length ?? 0) === 0 ? (
        <EmptyState
          icon={BellRing}
          title={t('page.empty.title')}
          description={t('page.empty.description')}
        />
      ) : (
        <>
          <ul className="space-y-2">
            {list.data?.items.map((n) => (
              <li key={n.id}>
                <Row
                  n={n}
                  locale={locale}
                  onClick={() => {
                    if (!n.isRead) markRead.mutate(n.id);
                    const href = notificationHref(n);
                    if (href) navigate(href);
                  }}
                />
              </li>
            ))}
          </ul>
          {pageCount > 1 ? (
            <div className="flex items-center justify-end gap-2 text-xs text-text-muted">
              <span>
                {page} / {pageCount}
              </span>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                aria-label={t('page.prevPage')}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-8"
                disabled={page >= pageCount}
                onClick={() => setPage((p) => p + 1)}
                aria-label={t('page.nextPage')}
              >
                <ChevronRight className="size-4" />
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
