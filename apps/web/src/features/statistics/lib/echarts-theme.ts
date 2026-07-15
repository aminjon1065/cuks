import { useEffect, useState } from 'react';
import { cssToken } from '@/features/map/lib/map-config';

/** Resolved design-system colours for chart theming (docs/06 §2). */
export interface ChartTheme {
  text: string;
  textMuted: string;
  border: string;
  surface: string;
  primary: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  sev: string[];
  palette: string[];
}

/** Read the current theme's chart colours off the CSS tokens (re-read whenever the
 *  app theme toggles, via {@link useThemeVersion}). */
export function readChartTheme(): ChartTheme {
  const primary = cssToken('--primary', '#1256a0');
  const info = cssToken('--info', '#0369a1');
  const success = cssToken('--success', '#15803d');
  const warning = cssToken('--warning', '#b45309');
  const danger = cssToken('--danger', '#b91c1c');
  const sev = [
    cssToken('--sev-1', '#64748b'),
    cssToken('--sev-2', '#ca8a04'),
    cssToken('--sev-3', '#ea580c'),
    cssToken('--sev-4', '#dc2626'),
    cssToken('--sev-5', '#7f1d1d'),
  ];
  return {
    text: cssToken('--text', '#0f172a'),
    textMuted: cssToken('--text-muted', '#64748b'),
    border: cssToken('--border', '#e2e8f0'),
    surface: cssToken('--surface', '#ffffff'),
    primary,
    success,
    warning,
    danger,
    info,
    sev,
    palette: [primary, info, success, warning, danger, sev[1]!, sev[3]!],
  };
}

/** Bumps a counter whenever the app theme (a class on `<html>`) toggles, so charts
 *  can re-resolve their colours. */
export function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setVersion((value) => value + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return version;
}
