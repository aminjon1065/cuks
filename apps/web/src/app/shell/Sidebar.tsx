import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import type { MeResponse } from '@cuks/shared';
import { Avatar, AvatarFallback, Tooltip, TooltipContent, TooltipTrigger, cn } from '@cuks/ui';
import { useVisibleByPermission } from '@/lib/ability';
import { useUiStore } from '@/lib/ui-store';
import { useMyOverdueCount } from '@/features/tasks/api/queries';
import { ADMIN_NAV, MAIN_NAV, type NavItem } from './nav-items';
import { ThemeToggle } from './ThemeToggle';

function NavRow({
  item,
  collapsed,
  badge = 0,
}: {
  item: NavItem;
  collapsed: boolean;
  /** A count rendered as an attention pill (e.g. overdue tasks); 0 hides it. */
  badge?: number;
}): React.JSX.Element {
  const { t } = useTranslation('nav');
  const label = t(`items.${item.key}`);
  const Icon = item.icon;
  const link = (
    <NavLink
      to={item.path}
      end={item.path === '/app'}
      className={({ isActive }) =>
        cn(
          'relative flex items-center gap-3 rounded-md px-2.5 py-2 text-[13px] font-medium transition-colors',
          collapsed && 'justify-center',
          isActive
            ? 'bg-primary/10 text-primary'
            : 'text-text-muted hover:bg-surface-2 hover:text-text',
        )
      }
    >
      <Icon className="size-[18px] shrink-0" />
      {collapsed ? null : <span className="truncate">{label}</span>}
      {badge > 0 ? (
        collapsed ? (
          <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-danger" />
        ) : (
          <span className="ml-auto min-w-5 rounded-full bg-danger px-1.5 text-center text-[11px] font-semibold leading-5 text-white">
            {badge > 99 ? '99+' : badge}
          </span>
        )
      ) : null}
    </NavLink>
  );

  if (!collapsed) return link;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{link}</TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}

export function Sidebar({ me }: { me: MeResponse }): React.JSX.Element {
  const { t } = useTranslation('nav');
  const { t: tc } = useTranslation('common');
  const storedCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const toggle = useUiStore((s) => s.toggleSidebar);
  const [compactViewport, setCompactViewport] = useState(
    () => window.matchMedia('(max-width: 1023px)').matches,
  );
  const collapsed = storedCollapsed || compactViewport;
  const adminItems = useVisibleByPermission(ADMIN_NAV);
  const overdue = useMyOverdueCount();

  const primaryOrg = me.orgContext.find((o) => o.isPrimary) ?? me.orgContext[0];

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const sync = (): void => setCompactViewport(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  return (
    <aside
      className={cn(
        'flex h-screen flex-col border-r border-border bg-surface transition-[width] duration-150 print:hidden',
        collapsed ? 'w-16' : 'w-60',
      )}
    >
      <div
        className={cn(
          'flex h-14 items-center gap-2 border-b border-border px-3',
          collapsed && 'justify-center px-0',
        )}
      >
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-fg">
          Ц
        </div>
        {collapsed ? null : (
          <span className="truncate text-sm font-semibold text-text">{tc('appName')}</span>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {MAIN_NAV.map((item) => (
          <NavRow
            key={item.key}
            item={item}
            collapsed={collapsed}
            badge={item.key === 'tasks' ? (overdue.data ?? 0) : 0}
          />
        ))}

        {adminItems.length > 0 ? (
          <>
            <div className="px-2.5 pb-1 pt-4">
              {collapsed ? (
                <div className="mx-auto h-px w-6 bg-border" />
              ) : (
                <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  {t('sections.admin')}
                </span>
              )}
            </div>
            {adminItems.map((item) => (
              <NavRow key={item.key} item={item} collapsed={collapsed} />
            ))}
          </>
        ) : null}
      </nav>

      <div className="border-t border-border p-2">
        <div
          className={cn(
            'flex items-center gap-2 rounded-md px-1.5 py-1.5',
            collapsed && 'justify-center',
          )}
        >
          <Avatar className="size-8 shrink-0">
            <AvatarFallback>{me.shortName.slice(0, 2)}</AvatarFallback>
          </Avatar>
          {collapsed ? null : (
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-text">{me.shortName}</div>
              {primaryOrg ? (
                <div className="truncate text-xs text-text-muted">{primaryOrg.positionName}</div>
              ) : null}
            </div>
          )}
        </div>
        <div
          className={cn('mt-1 flex items-center gap-1', collapsed ? 'flex-col' : 'justify-between')}
        >
          <ThemeToggle collapsed={collapsed} />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={toggle}
                aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
                className="hidden size-8 items-center justify-center rounded-md text-text-muted hover:bg-surface-2 hover:text-text lg:flex"
              >
                {collapsed ? (
                  <PanelLeftOpen className="size-4" />
                ) : (
                  <PanelLeftClose className="size-4" />
                )}
              </button>
            </TooltipTrigger>
            <TooltipContent side="right">
              {collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </aside>
  );
}
