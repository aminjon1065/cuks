/** App-wide constants shared between backend and frontend. */

/** Display timezone (DB stores UTC — docs/01, CLAUDE.md §2). */
export const DISPLAY_TIMEZONE = 'Asia/Dushanbe' as const;

/** REST API base (docs/04 §REST): `/api/v1`. Health lives at `/api/health`. */
export const API_PREFIX = 'api' as const;
export const API_VERSION = '1' as const;

/** Pagination defaults for table-style lists (docs/04 §Pagination). */
export const DEFAULT_PAGE = 1 as const;
export const DEFAULT_PAGE_SIZE = 50 as const;
export const MAX_PAGE_SIZE = 200 as const;

/** Supported UI locales (ru primary, tg secondary — docs/01 §i18n). */
export const LOCALES = ['ru', 'tg'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'ru';
