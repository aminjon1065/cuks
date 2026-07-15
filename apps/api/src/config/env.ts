import { z } from 'zod';
import { LOCKOUT_MAX_ATTEMPTS, LOCKOUT_WINDOW_SECONDS } from '@cuks/shared';

/**
 * `FOO=` in `.env` (present, blank) must mean "unset" for an optional field —
 * otherwise `foo ?? fallback` never falls back, since `??` only triggers on
 * `null`/`undefined`, not `''`. `.env.example` ships several vars this way.
 */
const optionalString = () =>
  z
    .string()
    .optional()
    .transform((v) => (v === '' ? undefined : v));

/**
 * Environment schema, validated at boot (fail-fast — docs/01 §Configuration).
 * The exhaustive variable list lives in `.env.example`. Variables for later
 * phases (LiveKit, SMTP, GeoServer, Martin, CA) are optional so the platform
 * boots during phase 0 without them.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    HOST: z.string().default('0.0.0.0'),
    APP_ORIGIN: z.string().url().default('http://localhost:5173'),
    TZ: z.string().default('Asia/Dushanbe'),
    // Fastify trustProxy: number of proxy hops to trust (e.g. "1" behind Caddy) or
    // a comma-separated IP/subnet list. Unset = trust none (request.ip = socket IP).
    // Trusting all proxies would let clients spoof X-Forwarded-For (docs/09 §1).
    TRUST_PROXY: optionalString(),

    // Core infrastructure (required — validated presence at boot).
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
    // AES-256-GCM key for field encryption (TOTP secrets). Derived from
    // SESSION_SECRET when absent; set a dedicated value in production.
    ENCRYPTION_KEY: optionalString(),

    // Anti-bruteforce login lockout (docs/05 §1). Defaults are the strict
    // production values; a dev environment may loosen them, and 0 disables the
    // lockout entirely (only outside production — see superRefine below).
    AUTH_LOCKOUT_MAX_ATTEMPTS: z.coerce.number().int().min(0).default(LOCKOUT_MAX_ATTEMPTS),
    AUTH_LOCKOUT_WINDOW_SECONDS: z.coerce.number().int().positive().default(LOCKOUT_WINDOW_SECONDS),

    // Object storage (MinIO / S3).
    S3_ENDPOINT: z.string().url(),
    S3_ACCESS_KEY: z.string().min(1),
    S3_SECRET_KEY: z.string().min(1),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().default('cuks'),

    // Later phases — optional for now.
    SMTP_URL: optionalString(),
    LIVEKIT_URL: optionalString(),
    LIVEKIT_API_KEY: optionalString(),
    LIVEKIT_API_SECRET: optionalString(),
    // GeoServer WMS/WFS publication (docs/modules/10 §7, task 2.9). All optional:
    // when GEOSERVER_URL is unset, publication is simply unavailable and the map
    // works as before. The datastore reaches PostGIS from inside the docker network
    // (its own host, not the public one below).
    GEOSERVER_URL: optionalString(),
    GEOSERVER_ADMIN_USER: z.string().default('admin'),
    GEOSERVER_ADMIN_PASSWORD: optionalString(),
    GEOSERVER_WORKSPACE: z.string().default('cuks'),
    GEOSERVER_PG_HOST: z.string().default('postgres'),
    GEOSERVER_PG_PORT: z.coerce.number().int().positive().default(5432),
    // The DB user GeoServer's datastore connects as — a gis_reader-scoped role in
    // production (docs/09 §Права PG); the dev default is the platform user.
    GEOSERVER_PG_USER: z.string().default('cuks'),
    GEOSERVER_PG_PASSWORD: z.string().default('cuks'),
    // Public PostGIS connection shown to GIS specialists (QGIS → PostGIS direct).
    // The host clients actually reach — a VPN/LAN address in production, localhost
    // in dev (docs/modules/10 §7).
    GIS_PG_PUBLIC_HOST: z.string().default('localhost'),
    GIS_PG_PUBLIC_PORT: z.coerce.number().int().positive().default(5432),
    GIS_PG_PUBLIC_DATABASE: z.string().default('cuks'),
    MARTIN_URL: optionalString(),
    // Internal signing CA (docs/09-security.md §4, task 3.5). The root ECDSA P-384 key
    // lives (encrypted) in the `ca_data` volume; the passphrase decrypts it. When unset,
    // the CA is initialised lazily into CA_DATA_DIR using a dev passphrase derived from
    // SESSION_SECRET — a dedicated CA_PASSPHRASE is required in production.
    CA_DATA_DIR: z.string().default('.ca'),
    CA_PASSPHRASE: optionalString(),
  })
  .superRefine((env, ctx) => {
    // In production require a dedicated field-encryption key, decoupled from
    // SESSION_SECRET so rotating one does not invalidate the other (docs/09).
    if (env.NODE_ENV === 'production' && (env.ENCRYPTION_KEY ?? '').length < 32) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ENCRYPTION_KEY'],
        message: 'ENCRYPTION_KEY (min 32 chars) is required in production',
      });
    }
    // The signing CA key must be protected by a real passphrase in production, not the
    // SESSION_SECRET-derived dev fallback (docs/09-security.md §4).
    if (env.NODE_ENV === 'production' && (env.CA_PASSPHRASE ?? '').length < 16) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['CA_PASSPHRASE'],
        message: 'CA_PASSPHRASE (min 16 chars) is required in production',
      });
    }
    // The lockout is a security control — it can be relaxed for local dev but never
    // switched off in production (docs/09 §7, CLAUDE.md §6).
    if (env.NODE_ENV === 'production' && env.AUTH_LOCKOUT_MAX_ATTEMPTS < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['AUTH_LOCKOUT_MAX_ATTEMPTS'],
        message: 'AUTH_LOCKOUT_MAX_ATTEMPTS must be at least 1 in production',
      });
    }
  });

export type AppConfig = z.infer<typeof envSchema>;

/** Parse + validate `process.env`. Throws a readable aggregated error on failure. */
export function validateEnv(raw: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
