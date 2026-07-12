import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '../../config/config.service';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

/**
 * Symmetric field encryption (AES-256-GCM) for secrets at rest, e.g. TOTP
 * secrets (docs/07 §users "totp_secret шифр.", docs/09). Key is derived from
 * ENCRYPTION_KEY, falling back to SESSION_SECRET (docs/05 §1 uses node:crypto).
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const secret = config.get('ENCRYPTION_KEY') ?? config.get('SESSION_SECRET');
    // Deterministic 32-byte key; the fixed salt is fine for a single deployment key.
    this.key = scryptSync(secret, 'cuks.field-encryption.v1', KEY_BYTES);
  }

  /** Returns base64(iv | authTag | ciphertext). */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
  }

  decrypt(payload: string): string {
    const buf = Buffer.from(payload, 'base64');
    const iv = buf.subarray(0, IV_BYTES);
    const authTag = buf.subarray(IV_BYTES, IV_BYTES + 16);
    const ciphertext = buf.subarray(IV_BYTES + 16);
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }
}
