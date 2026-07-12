import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { AbilityProvider } from '@/lib/ability';
import { useMe } from '@/features/auth/api/queries';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { CommandPalette } from './CommandPalette';

/** Authenticated application frame (docs/06 §3): Sidebar + Topbar + routed content. */
export function AppShell(): React.JSX.Element | null {
  const { data: me } = useMe();
  const [commandOpen, setCommandOpen] = useState(false);

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
      <div className="flex h-screen overflow-hidden bg-background">
        <Sidebar me={me} />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar me={me} onOpenCommand={() => setCommandOpen(true)} />
          <main className="flex-1 overflow-y-auto p-6">
            <Outlet />
          </main>
        </div>
      </div>
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />
    </AbilityProvider>
  );
}
