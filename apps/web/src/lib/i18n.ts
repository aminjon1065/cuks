import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

/**
 * i18next setup (docs/03, CLAUDE.md §2). UI language is Russian with a Tajik
 * (`tg`) locale; translation keys are English. Namespaces mirror backend modules
 * and are loaded from `src/locales/<lng>/<namespace>.json`. Hardcoded UI strings
 * are forbidden — everything renders through `t()`.
 */
export const SUPPORTED_LOCALES = ['ru', 'tg'] as const;
export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = 'ru';

const modules = import.meta.glob<Record<string, unknown>>('../locales/**/*.json', {
  eager: true,
  import: 'default',
});

const resources: Record<string, Record<string, Record<string, unknown>>> = {};
for (const [path, content] of Object.entries(modules)) {
  const match = /\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
  if (!match) continue;
  const [, lng, ns] = match;
  if (!lng || !ns) continue;
  (resources[lng] ??= {})[ns] = content;
}

void i18n.use(initReactI18next).init({
  resources,
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  defaultNS: 'common',
  ns: ['common', 'auth', 'nav', 'dashboard', 'notifications', 'admin', 'files'],
  interpolation: { escapeValue: false },
  returnNull: false,
});

export default i18n;
