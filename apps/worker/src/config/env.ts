import { z } from 'zod';

/** Worker env (subset of the platform env; docs/03 §Env). Validated at boot. */
export const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  REDIS_URL: z.string().url(),
  DATABASE_URL: z.string().url(),
  SMTP_URL: z.string().optional(),
  TZ: z.string().default('Asia/Dushanbe'),
  // Own S3 client (docs/plan/STATUS.md 1.1 decision: each app owns its infra
  // client, no cross-app imports) — needed by av-scan/preview/text-extract/
  // retention to read/write MinIO objects directly.
  S3_ENDPOINT: z.string().url(),
  S3_ACCESS_KEY: z.string().min(1),
  S3_SECRET_KEY: z.string().min(1),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('cuks'),
  // ClamAV clamd daemon (docs/09 §2).
  CLAMAV_HOST: z.string().default('localhost'),
  CLAMAV_PORT: z.coerce.number().int().positive().default(3310),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function validateEnv(raw: Record<string, unknown>): WorkerEnv {
  return workerEnvSchema.parse(raw);
}
