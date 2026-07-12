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

/**
 * Argon2id parameters (docs/05 §1: memory 64MB, iterations 3, parallelism 4).
 * `memoryCost` is in KiB. Consumers add `type: argon2.argon2id`.
 */
export const ARGON2_OPTIONS = {
  memoryCost: 65_536,
  timeCost: 3,
  parallelism: 4,
} as const;

/** Password policy (docs/05 §1): ≥ 12 chars, change required on first login. */
export const PASSWORD_MIN_LENGTH = 12;
