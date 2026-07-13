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

/** Session + CSRF cookies and headers (docs/05 §1, docs/09 §1). */
export const SESSION_COOKIE = 'cuks_session';
export const CSRF_COOKIE = 'cuks_csrf';
export const CSRF_HEADER = 'x-csrf-token';

/** Session lifetimes (docs/05 §1): 12h sliding, 30d with "remember me". */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
export const SESSION_REMEMBER_TTL_SECONDS = 30 * 24 * 60 * 60;
export const MAX_SESSIONS_PER_USER = 10;

/** Anti-bruteforce (docs/05 §1): 5 failures → 15-minute lockout by username and IP. */
export const LOCKOUT_MAX_ATTEMPTS = 5;
export const LOCKOUT_WINDOW_SECONDS = 15 * 60;

/** Rate limit for /auth/login per IP (docs/09 §1: /auth/* 10 rpm). */
export const AUTH_LOGIN_RATE_PER_MINUTE = 10;

/** TOTP one-time backup codes (docs/05 §1). */
export const TOTP_BACKUP_CODES_COUNT = 10;

/** File uploads (docs/09 §2, docs/modules/12 §4). */
export const MAX_FILE_SIZE_BYTES = 2 * 1024 ** 3; // 2 GiB
export const UPLOAD_PART_SIZE_BYTES = 16 * 1024 ** 2; // 16 MiB chunks, uploaded in parallel
// Generous — a slow link on a large multipart upload can take a while between parts.
export const UPLOAD_PART_URL_EXPIRY_SECONDS = 60 * 60;
export const DOWNLOAD_URL_EXPIRY_SECONDS = 5 * 60;
