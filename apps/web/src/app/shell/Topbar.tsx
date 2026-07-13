import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell, LogOut, Search } from 'lucide-react';
import type { MeResponse } from '@cuks/shared';
import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@cuks/ui';
import { useLogout } from '@/features/auth/api/queries';
import { useNotificationStream } from '@/features/notifications/useNotificationStream';
import { ADMIN_NAV, MAIN_NAV } from './nav-items';
import { NotificationsPopover } from './NotificationsPopover';

function useSectionTitle(): string {
  const { t } = useTranslation('nav');
  const { t: tn } = useTranslation('notifications');
  const { pathname } = useLocation();
  if (pathname.startsWith('/app/settings/notifications')) return tn('prefs.title');
  if (pathname.startsWith('/app/notifications')) return tn('page.title');
  const all = [...MAIN_NAV, ...ADMIN_NAV];
  const match = all
    .filter((i) => pathname === i.path || (i.path !== '/app' && pathname.startsWith(i.path)))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return match ? t(`items.${match.key}`) : t('items.dashboard');
}

export function Topbar({
  onOpenCommand,
  me,
}: {
  onOpenCommand: () => void;
  me: MeResponse;
}): React.JSX.Element {
  const { t } = useTranslation('common');
  const { t: ta } = useTranslation('auth');
  const { t: tn } = useTranslation('notifications');
  const navigate = useNavigate();
  const logout = useLogout();
  const title = useSectionTitle();
  useNotificationStream();

  const onLogout = (): void => {
    logout.mutate(undefined, { onSettled: () => navigate('/login', { replace: true }) });
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
      <h1 className="text-sm font-semibold text-text">{title}</h1>

      <button
        type="button"
        onClick={onOpenCommand}
        className="ml-auto flex h-8 w-64 items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 text-[13px] text-text-muted hover:bg-surface"
      >
        <Search className="size-4" />
        <span className="flex-1 text-left">{t('actions.search')}</span>
        <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 font-mono text-[11px]">
          ⌘K
        </kbd>
      </button>

      <NotificationsPopover me={me} />

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={ta('profile.menu')}>
            <Avatar className="size-7">
              <AvatarFallback>{me.shortName.slice(0, 2)}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuLabel>
            <div className="text-[13px] font-medium text-text">{me.fullName}</div>
            <div className="text-xs font-normal text-text-muted">@{me.username}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate('/app/settings/notifications')}>
            <Bell />
            {tn('prefs.title')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem destructive onSelect={onLogout}>
            <LogOut />
            {t('actions.logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
