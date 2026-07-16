import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { AbilityProvider } from '@/lib/ability';
import { SocketProvider } from '@/lib/socket';
import { useMe } from '@/features/auth/api/queries';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { CommandPalette } from './CommandPalette';

/** Authenticated application frame (docs/06 §3): Sidebar + Topbar + routed content. */
export function AppShell(): React.JSX.Element | null {
  const { data: me } = useMe();
  const [commandOpen, setCommandOpen] = useState(false);
  // The map and chat are full-bleed (docs/06 §3): no content padding, no page scroll — they own their
  // own full-height layout and internal scroll regions.
  const { pathname } = useLocation();
  const fullbleed = pathname === '/app/map' || pathname.startsWith('/app/chat');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((open) => !open);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  if (!me) return null;

  return (
    <AbilityProvider rules={me.abilityRules}>
      <SocketProvider>
        <div data-testid="app-shell" className="flex h-screen overflow-hidden bg-background">
          <Sidebar me={me} />
          <div className="flex min-w-0 flex-1 flex-col">
            <Topbar me={me} onOpenCommand={() => setCommandOpen(true)} />
            <main
              className={
                fullbleed ? 'relative flex-1 overflow-hidden' : 'flex-1 overflow-y-auto p-6'
              }
            >
              <Outlet />
            </main>
          </div>
        </div>
        <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
      </SocketProvider>
    </AbilityProvider>
  );
}
