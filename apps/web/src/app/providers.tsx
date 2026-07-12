import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { TooltipProvider } from '@cuks/ui';
import i18n from '@/lib/i18n';
import { createQueryClient } from '@/lib/query-client';
import { useApplyTheme } from '@/lib/theme';

function ThemeEffect(): null {
  useApplyTheme();
  return null;
}

/** App-wide providers (docs/03): Query, i18n, Theme, Tooltip. Ability is scoped to
 * the authenticated shell; Socket arrives in phase 0.9. */
export function Providers({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <I18nextProvider i18n={i18n}>
        <TooltipProvider delayDuration={200}>
          <ThemeEffect />
          {children}
        </TooltipProvider>
      </I18nextProvider>
    </QueryClientProvider>
  );
}
