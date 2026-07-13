import { createBrowserRouter, Navigate } from 'react-router-dom';
import { AuthGate } from './AuthGate';
import { AppShell } from './shell/AppShell';
import { ComingSoonPage } from './pages/ComingSoonPage';
import { ForbiddenPage } from './pages/ForbiddenPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { LoginPage } from '@/features/auth/pages/LoginPage';
import { ForcePasswordPage } from '@/features/auth/pages/ForcePasswordPage';
import { EnrollTotpPage } from '@/features/auth/pages/EnrollTotpPage';
import { DashboardPage } from '@/features/dashboard/pages/DashboardPage';
import { NotificationsPage } from '@/features/notifications/pages/NotificationsPage';
import { NotificationPrefsPage } from '@/features/notifications/pages/NotificationPrefsPage';
import { UsersPage } from '@/features/admin/pages/UsersPage';
import { RolesPage } from '@/features/admin/pages/RolesPage';
import { OrgPage } from '@/features/admin/pages/OrgPage';
import { AuditPage } from '@/features/admin/pages/AuditPage';

// Module sections not yet implemented render the ComingSoon placeholder inside the
// shell, so every sidebar entry navigates somewhere real (docs/06 §3).
const PLACEHOLDER_PATHS = [
  'map',
  'incidents',
  'analytics',
  'docs',
  'tasks',
  'chat',
  'meet',
  'files',
];

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/app" replace /> },
  {
    path: '/login',
    element: (
      <AuthGate expect="login">
        <LoginPage />
      </AuthGate>
    ),
  },
  {
    path: '/force-password',
    element: (
      <AuthGate expect="force-password">
        <ForcePasswordPage />
      </AuthGate>
    ),
  },
  {
    path: '/enroll-totp',
    element: (
      <AuthGate expect="enroll-totp">
        <EnrollTotpPage />
      </AuthGate>
    ),
  },
  { path: '/403', element: <ForbiddenPage /> },
  {
    path: '/app',
    element: (
      <AuthGate expect="app">
        <AppShell />
      </AuthGate>
    ),
    children: [
      { index: true, element: <DashboardPage /> },
      { path: 'notifications', element: <NotificationsPage /> },
      { path: 'settings/notifications', element: <NotificationPrefsPage /> },
      { path: 'admin/users', element: <UsersPage /> },
      { path: 'admin/roles', element: <RolesPage /> },
      { path: 'admin/org', element: <OrgPage /> },
      { path: 'admin/audit', element: <AuditPage /> },
      ...PLACEHOLDER_PATHS.map((path) => ({ path, element: <ComingSoonPage /> })),
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
