import { z } from 'zod';

/**
 * Environment schema, validated at boot (fail-fast — docs/01 §Configuration).
 * The exhaustive variable list lives in `.env.example`. Variables for later
 * phases (LiveKit, SMTP, GeoServer, Martin, CA) are optional so the platform
 * boots during phase 0 without them.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  TZ: z.string().default('Asia/Dushanbe'),

  // Core infrastructure (required — validated presence at boot).
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

  // Object storage (MinIO / S3).
  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('cuks'),

  // Later phases — optional for now.
  SMTP_URL: z.string().optional(),
  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  GEOSERVER_URL: z.string().optional(),
  GEOSERVER_ADMIN_PASSWORD: z.string().optional(),
  MARTIN_URL: z.string().optional(),
  CA_KEY_PATH: z.string().optional(),
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
