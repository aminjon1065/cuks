import { Loader2 } from 'lucide-react';
import { Navigate, useLocation } from 'react-router-dom';
import { ApiError } from '@/lib/api-client';
import { useMe } from '@/features/auth/api/queries';

/** Where the current session is allowed to be, given pending auth steps (docs/05). */
export type Gate = 'loading' | 'login' | 'force-password' | 'enroll-totp' | 'app';

const ROUTE: Record<Exclude<Gate, 'loading'>, string> = {
  login: '/login',
  'force-password': '/force-password',
  'enroll-totp': '/enroll-totp',
  app: '/app',
};

function useGate(): Gate {
  const { data: me, isLoading, error } = useMe();
  if (isLoading) return 'loading';
  if (error) {
    // 401 = no/expired session; any other failure also routes to login to re-auth.
    if (error instanceof ApiError && error.status !== 401) return 'login';
    return 'login';
  }
  if (!me) return 'login';
  if (me.mustChangePassword) return 'force-password';
  if (me.totpRequired && !me.totpEnabled) return 'enroll-totp';
  return 'app';
}

function FullScreenLoader(): React.JSX.Element {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <Loader2 className="size-6 animate-spin text-text-muted" />
    </div>
  );
}

/**
 * Renders `children` only when the session's gate matches `expect`; otherwise
 * redirects to wherever the session belongs. Used to wrap both the app shell and
 * the individual unauthenticated / step screens so the flow can't be skipped.
 */
export function AuthGate({
  expect,
  children,
}: {
  expect: Exclude<Gate, 'loading'>;
  children: React.ReactNode;
}): React.JSX.Element {
  const gate = useGate();
  const location = useLocation();

  if (gate === 'loading') return <FullScreenLoader />;
  if (gate === expect) return <>{children}</>;

  const to = ROUTE[gate];
  const state = gate === 'login' && expect === 'app' ? { from: location.pathname } : undefined;
  return <Navigate to={to} replace state={state} />;
}
