import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type Redis from 'ioredis';
import { type Database, totpBackupCodes } from '@cuks/db';
import { TOTP_BACKUP_CODES_COUNT } from '@cuks/shared';
import { authenticator } from 'otplib';
import { DB } from '../../common/db/db.module';
import { REDIS } from '../../common/redis/redis.module';

const ISSUER = 'CUKS';
const TOTP_STEP_SECONDS = 30;

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** TOTP (RFC 6238) via otplib + one-time backup codes (docs/05 §1). */
@Injectable()
export class TotpService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  generateSecret(): string {
    return authenticator.generateSecret();
  }

  keyUri(username: string, secret: string): string {
    return authenticator.keyuri(username, ISSUER, secret);
  }

  /** Stateless verify (used to enable/disable 2FA under an authenticated session). */
  verify(token: string, secret: string): boolean {
    try {
      return authenticator.verify({ token, secret });
    } catch {
      return false;
    }
  }

  /**
   * Replay-protected verify for login: a TOTP code is valid for a whole ~30s step,
   * so the same code must not be accepted twice. Records the last accepted step
   * per user in Redis and rejects a step already consumed (RFC 6238 §5.2).
   */
  async verifyForLogin(userId: string, token: string, secret: string): Promise<boolean> {
    let delta: number | null;
    try {
      delta = authenticator.checkDelta(token, secret);
    } catch {
      return false;
    }
    if (delta === null) return false;

    const step = Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS) + delta;
    const key = `totp:laststep:${userId}`;
    const last = await this.redis.get(key);
    if (last !== null && step <= Number(last)) return false; // replay

    await this.redis.set(key, String(step), 'EX', TOTP_STEP_SECONDS * 3);
    return true;
  }

  /** Replace the user's backup codes; returns the plaintext codes to show once. */
  async regenerateBackupCodes(userId: string): Promise<string[]> {
    const codes = Array.from({ length: TOTP_BACKUP_CODES_COUNT }, () =>
      randomBytes(5).toString('hex'),
    );
    await this.db.delete(totpBackupCodes).where(eq(totpBackupCodes.userId, userId));
    await this.db
      .insert(totpBackupCodes)
      .values(codes.map((code) => ({ userId, codeHash: sha256(code) })));
    return codes;
  }

  /** Atomically consume an unused backup code; returns true if it matched. */
  async consumeBackupCode(userId: string, code: string): Promise<boolean> {
    const hash = sha256(code.trim());
    const consumed = await this.db
      .update(totpBackupCodes)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(totpBackupCodes.userId, userId),
          eq(totpBackupCodes.codeHash, hash),
          isNull(totpBackupCodes.usedAt),
        ),
      )
      .returning({ id: totpBackupCodes.id });
    return consumed.length > 0;
  }

  async clearBackupCodes(userId: string): Promise<void> {
    await this.db.delete(totpBackupCodes).where(eq(totpBackupCodes.userId, userId));
  }
}
