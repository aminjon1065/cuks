import { z } from 'zod';

/** Worker env (subset of the platform env; docs/03 §Env). Validated at boot. */
export const workerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  REDIS_URL: z.string().url(),
  DATABASE_URL: z.string().url(),
  SMTP_URL: z.string().optional(),
  TZ: z.string().default('Asia/Dushanbe'),
});

export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function validateEnv(raw: Record<string, unknown>): WorkerEnv {
  return workerEnvSchema.parse(raw);
}
