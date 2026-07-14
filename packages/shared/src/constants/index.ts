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

/** Storage quotas (docs/modules/12 §4). Org quota has no stated default — unlimited
 *  until an admin sets one; only the personal default is spec'd. */
export const DEFAULT_PERSONAL_QUOTA_BYTES = 10 * 1024 ** 3; // 10 GiB

/** Abandoned multipart-upload staging rows (docs/modules/12 §8: "temp-uploads 24 ч"). */
export const UPLOAD_STAGING_TTL_HOURS = 24;

/** Trash retention before permanent purge (docs/modules/12 §8: "корзина 30 дн"). */
export const TRASH_RETENTION_DAYS = 30;

/** Internal share-link token entropy (docs/modules/12 §3) — 32 random bytes,
 *  base64url-encoded, generated with node:crypto (docs/09 — no custom crypto). */
export const FILE_LINK_TOKEN_BYTES = 32;

/** SPA route a copied internal link points at; the client resolves `:token`
 *  against `POST /files/links/:token/accept`. Kept here so api (builds it) and
 *  web (routes it) can't drift. */
export const FILE_LINK_URL_PREFIX = '/app/files/link';

/**
 * Preview sizes (docs/modules/12 §5: "sharp-превью 3 размеров") — longest-edge px,
 * re-encoded to webp regardless of source format (docs/09 §2: EXIF-очистка via
 * re-encode; sharp strips metadata by default when not asked to keep it).
 */
export const PREVIEW_SIZES = { small: 256, medium: 720, large: 1600 } as const;
export type PreviewSize = keyof typeof PREVIEW_SIZES;

/** Cap on `file_versions.extracted_text` (docs/modules/12 §5) — FTS doesn't need
 *  megabytes of text, and an unbounded column would bloat storage/index size. */
export const MAX_EXTRACTED_TEXT_LENGTH = 100_000;

/**
 * Binary types that are never legitimate uploads regardless of declared MIME
 * (docs/09 §2: "опасные типы... помечаются"). Detected from real file bytes
 * (`file-type`), not the client-supplied Content-Type. Text-based dangerous
 * content (SVG with embedded script, shell scripts) has no binary magic-byte
 * signature `file-type` can key off — those get their own real-bytes checks in
 * apps/worker/src/queues/av-scan/content-sniff.ts instead of living in this list.
 */
export const DANGEROUS_MIME_TYPES = [
  'application/x-msdownload', // .exe
  'application/x-executable',
  'application/x-elf',
  'application/x-mach-binary',
  'application/vnd.microsoft.portable-executable',
  'application/x-msi',
] as const;

/** MIME types the `text-extract` job knows how to handle (docs/modules/12 §5/§8). */
export const PDF_MIME_TYPE = 'application/pdf';
export const DOCX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** A `file_versions` row stuck at `avStatus='pending'` this long (enqueue
 *  failure, exhausted BullMQ retries, an unreachable ClamAV) gets picked up by
 *  the retention sweep and re-enqueued — see retention.processor.ts. Well above
 *  normal scan latency (seconds) so an in-flight/queued scan is never re-queued
 *  as a duplicate. */
export const STALE_PENDING_SCAN_HOURS = 1;

// --- GIS / incidents (docs/modules/10, docs/07 §gis; phase 2) ---

/** Spatial reference for all stored geometry: WGS84 (docs/07 §gis). Display is
 *  web-mercator, done client-side by MapLibre — the DB stays 4326. */
export const GIS_SRID = 4326;

/** Incident number format `ЧС-{YYYY}-{seq}` (docs/modules/10 §3). The sequence is
 *  per-year; the prefix is the Russian abbreviation for ЧС (emergency). */
export const INCIDENT_NUMBER_PREFIX = 'ЧС';

/** Short-lived signed tile-access token TTL (docs/modules/10 §9). Issued by the
 *  api on map load; Caddy forward_auth validates it before proxying to Martin. An
 *  hour comfortably covers a map session and is re-issued on the next load. */
export const TILE_TOKEN_TTL_SECONDS = 60 * 60;

/** Bound on how long the `preview`/`text-extract` jobs let a single sharp/
 *  pdf-parse/mammoth call run before giving up — mirrors the explicit ClamAV
 *  socket timeout (clamd-client.ts) so a pathological/crafted file can't hang a
 *  worker slot indefinitely relying only on BullMQ's stalled-job defaults. */
export const JOB_PARSE_TIMEOUT_MS = 60_000;
