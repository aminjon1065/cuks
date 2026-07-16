import { lazy, Suspense } from 'react';
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
import { GisAccessPage } from '@/features/gis-access/pages/GisAccessPage';
import { GisDbAccountsPage } from '@/features/gis-access/pages/GisDbAccountsPage';
import { DocflowSettingsPage } from '@/features/docflow/pages/DocflowSettingsPage';
import { DocumentsPage } from '@/features/docflow/pages/DocumentsPage';
import { DocumentCardPage } from '@/features/docflow/pages/DocumentCardPage';
import { VerifyPage } from '@/features/docflow/pages/VerifyPage';
import { JournalsRegisterPage } from '@/features/docflow/pages/JournalsRegisterPage';
import { ControlPage } from '@/features/docflow/pages/ControlPage';
import { ReportsPage as DocflowReportsPage } from '@/features/docflow/pages/ReportsPage';
import { SubstitutionsPage } from '@/features/docflow/pages/SubstitutionsPage';
import { ProjectsPage as TasksProjectsPage } from '@/features/tasks/pages/ProjectsPage';
import { BoardPage } from '@/features/tasks/pages/BoardPage';
import { FilesPage } from '@/features/files/pages/FilesPage';

// The map pulls in MapLibre + basemap themes (~800 kB); lazy-load it so that
// weight only ships when the map is actually opened.
const MapPage = lazy(() =>
  import('@/features/map/pages/MapPage').then((m) => ({ default: m.MapPage })),
);
const IncidentsPage = lazy(() =>
  import('@/features/incidents/pages/IncidentsPage').then((m) => ({ default: m.IncidentsPage })),
);
const IncidentDetailPage = lazy(() =>
  import('@/features/incidents/pages/IncidentDetailPage').then((m) => ({
    default: m.IncidentDetailPage,
  })),
);
// The statistics dashboard pulls in ECharts (~1 MB); lazy-load so that weight ships
// only when the analytics page is opened.
const StatisticsPage = lazy(() =>
  import('@/features/statistics/pages/StatisticsPage').then((m) => ({ default: m.StatisticsPage })),
);
const ReportsPage = lazy(() =>
  import('@/features/reports/pages/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);

// Module sections not yet implemented render the ComingSoon placeholder inside the
// shell, so every sidebar entry navigates somewhere real (docs/06 §3).
const PLACEHOLDER_PATHS = ['chat', 'meet'];

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
      { path: 'files', element: <FilesPage /> },
      {
        path: 'incidents',
        element: (
          <Suspense fallback={<div className="h-full w-full bg-background" />}>
            <IncidentsPage />
          </Suspense>
        ),
      },
      {
        path: 'incidents/:id',
        element: (
          <Suspense fallback={<div className="h-full w-full bg-background" />}>
            <IncidentDetailPage />
          </Suspense>
        ),
      },
      {
        path: 'map',
        element: (
          <Suspense fallback={<div className="h-full w-full bg-background" />}>
            <MapPage />
          </Suspense>
        ),
      },
      { path: 'map/gis-access', element: <GisAccessPage /> },
      { path: 'admin/gis-access', element: <GisDbAccountsPage /> },
      { path: 'docs', element: <DocumentsPage /> },
      { path: 'docs/control', element: <ControlPage /> },
      { path: 'docs/reports', element: <DocflowReportsPage /> },
      { path: 'docs/substitutions', element: <SubstitutionsPage /> },
      { path: 'docs/journals', element: <JournalsRegisterPage /> },
      { path: 'docs/settings', element: <DocflowSettingsPage /> },
      { path: 'docs/:id', element: <DocumentCardPage /> },
      { path: 'verify/:signatureId', element: <VerifyPage /> },
      { path: 'tasks', element: <TasksProjectsPage /> },
      { path: 'tasks/:projectKey', element: <BoardPage /> },
      {
        path: 'analytics',
        element: (
          <Suspense fallback={<div className="h-full w-full bg-background" />}>
            <StatisticsPage />
          </Suspense>
        ),
      },
      {
        path: 'analytics/reports',
        element: (
          <Suspense fallback={<div className="h-full w-full bg-background" />}>
            <ReportsPage />
          </Suspense>
        ),
      },
      ...PLACEHOLDER_PATHS.map((path) => ({ path, element: <ComingSoonPage /> })),
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]);
