import { useEffect } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Theme preference (docs/06 §3). `system` follows the OS setting. */
export type ThemePreference = 'system' | 'light' | 'dark';

interface ThemeState {
  theme: ThemePreference;
  setTheme: (theme: ThemePreference) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: 'system',
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'cuks-theme' },
  ),
);

const prefersDark = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;

export function resolveTheme(theme: ThemePreference): 'light' | 'dark' {
  if (theme === 'system') return prefersDark() ? 'dark' : 'light';
  return theme;
}

function applyThemeClass(theme: ThemePreference): void {
  document.documentElement.classList.toggle('dark', resolveTheme(theme) === 'dark');
}

/** Applies the `.dark` class and tracks OS changes while preference is `system`. */
export function useApplyTheme(): void {
  const theme = useThemeStore((s) => s.theme);
  useEffect(() => {
    applyThemeClass(theme);
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (): void => applyThemeClass('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);
}
