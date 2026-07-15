import {
  KeyRound,
  BarChart3,
  CalendarClock,
  FileText,
  FolderClosed,
  LayoutDashboard,
  ListTodo,
  Map,
  MessageSquare,
  ShieldAlert,
  Users2,
  UsersRound,
  Building2,
  ScrollText,
  type LucideIcon,
} from 'lucide-react';

/** A single sidebar / command-palette entry. `permission` gates admin items. */
export interface NavItem {
  /** i18n key inside the `nav:items` namespace. */
  key: string;
  path: string;
  icon: LucideIcon;
  permission?: string;
}

export const MAIN_NAV: NavItem[] = [
  { key: 'dashboard', path: '/app', icon: LayoutDashboard },
  { key: 'map', path: '/app/map', icon: Map },
  { key: 'incidents', path: '/app/incidents', icon: ShieldAlert },
  { key: 'analytics', path: '/app/analytics', icon: BarChart3 },
  { key: 'docs', path: '/app/docs', icon: FileText },
  { key: 'tasks', path: '/app/tasks', icon: ListTodo },
  { key: 'chat', path: '/app/chat', icon: MessageSquare },
  { key: 'meet', path: '/app/meet', icon: CalendarClock },
  { key: 'files', path: '/app/files', icon: FolderClosed },
];

export const ADMIN_NAV: NavItem[] = [
  { key: 'adminUsers', path: '/app/admin/users', icon: Users2, permission: 'admin.users.manage' },
  {
    key: 'adminRoles',
    path: '/app/admin/roles',
    icon: UsersRound,
    permission: 'admin.roles.manage',
  },
  { key: 'adminOrg', path: '/app/admin/org', icon: Building2, permission: 'admin.org.manage' },
  { key: 'adminAudit', path: '/app/admin/audit', icon: ScrollText, permission: 'admin.audit.view' },
  {
    key: 'adminGisAccess',
    path: '/app/admin/gis-access',
    icon: KeyRound,
    permission: 'gis.pg.access',
  },
  {
    key: 'docflowSettings',
    path: '/app/docs/settings',
    icon: FileText,
    permission: 'docflow.journals.manage',
  },
];
