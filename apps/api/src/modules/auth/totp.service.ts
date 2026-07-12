import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { type Database, totpBackupCodes } from '@cuks/db';
import { TOTP_BACKUP_CODES_COUNT } from '@cuks/shared';
import { authenticator } from 'otplib';
import { DB } from '../../common/db/db.module';

const ISSUER = 'CUKS';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** TOTP (RFC 6238) via otplib + one-time backup codes (docs/05 §1). */
@Injectable()
export class TotpService {
  constructor(@Inject(DB) private readonly db: Database) {}

  generateSecret(): string {
    return authenticator.generateSecret();
  }

  keyUri(username: string, secret: string): string {
    return authenticator.keyuri(username, ISSUER, secret);
  }

  verify(token: string, secret: string): boolean {
    try {
      return authenticator.verify({ token, secret });
    } catch {
      return false;
    }
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

  /** Consume an unused backup code; returns true if it matched. */
  async consumeBackupCode(userId: string, code: string): Promise<boolean> {
    const hash = sha256(code.trim());
    const [row] = await this.db
      .select({ id: totpBackupCodes.id })
      .from(totpBackupCodes)
      .where(
        and(
          eq(totpBackupCodes.userId, userId),
          eq(totpBackupCodes.codeHash, hash),
          isNull(totpBackupCodes.usedAt),
        ),
      )
      .limit(1);
    if (!row) return false;
    await this.db
      .update(totpBackupCodes)
      .set({ usedAt: new Date() })
      .where(eq(totpBackupCodes.id, row.id));
    return true;
  }

  async clearBackupCodes(userId: string): Promise<void> {
    await this.db.delete(totpBackupCodes).where(eq(totpBackupCodes.userId, userId));
  }
}
