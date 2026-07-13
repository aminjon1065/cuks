import { describe, expect, it } from 'vitest';
import { validateEnv } from './env';

const REQUIRED: NodeJS.ProcessEnv = {
  DATABASE_URL: 'postgres://cuks:cuks@localhost:5432/cuks',
  REDIS_URL: 'redis://localhost:6379',
  SESSION_SECRET: 'a'.repeat(32),
  S3_ENDPOINT: 'http://localhost:9000',
  S3_ACCESS_KEY: 'cuks',
  S3_SECRET_KEY: 'cuks-dev-secret',
};

describe('validateEnv', () => {
  it('treats a blank optional var (`FOO=`) as unset, not as an empty string', () => {
    const env = validateEnv({ ...REQUIRED, ENCRYPTION_KEY: '', TRUST_PROXY: '' });
    expect(env.ENCRYPTION_KEY).toBeUndefined();
    expect(env.TRUST_PROXY).toBeUndefined();
  });

  it('keeps a real value for an optional var', () => {
    const env = validateEnv({ ...REQUIRED, ENCRYPTION_KEY: 'b'.repeat(32) });
    expect(env.ENCRYPTION_KEY).toBe('b'.repeat(32));
  });

  it('requires a >=32 char ENCRYPTION_KEY in production, blank included', () => {
    expect(() => validateEnv({ ...REQUIRED, NODE_ENV: 'production', ENCRYPTION_KEY: '' })).toThrow(
      /ENCRYPTION_KEY/,
    );
  });
});
