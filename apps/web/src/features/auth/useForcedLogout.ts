import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useSocketEvent } from '@/lib/socket';

/**
 * When an admin blocks the account or resets its credentials, the server pushes
 * `auth.forced_logout` to the user's room (docs/16 §1 acceptance: block ends the
 * session within seconds). Clear cached state and bounce to the login screen.
 * Mount once inside the authenticated shell.
 */
export function useForcedLogout(): void {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const onLogout = useCallback(() => {
    qc.clear();
    navigate('/login', { replace: true });
  }, [qc, navigate]);
  useSocketEvent('auth.forced_logout', onLogout);
}
