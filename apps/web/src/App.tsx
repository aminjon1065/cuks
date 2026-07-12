import type { JSX } from 'react';
import { cn } from '@cuks/ui';

/**
 * Phase-0 bootstrap placeholder. The real application shell (router, sidebar,
 * topbar, command palette, i18n) is built in phase 0.8 (docs/03 §apps/web).
 */
export function App(): JSX.Element {
  return (
    <main
      data-testid="app-root"
      className={cn('flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center')}
    >
      <span className="text-xs font-medium uppercase tracking-widest text-[var(--color-muted-fg)]">
        Phase 0 · foundation
      </span>
      <h1 className="text-4xl font-semibold tracking-tight">ЦУКС</h1>
      <p className="max-w-md text-sm text-[var(--color-muted-fg)]">
        Digital platform for the Committee of Emergency Situations. Application shell arrives in
        phase 0.8.
      </p>
    </main>
  );
}
