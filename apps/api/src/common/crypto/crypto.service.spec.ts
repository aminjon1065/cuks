import { describe, expect, it } from 'vitest';
import { CryptoService } from './crypto.service';
import type { ConfigService } from '../../config/config.service';

const fakeConfig = {
  get: (key: string) =>
    key === 'ENCRYPTION_KEY' ? undefined : 'test-secret-at-least-32-characters-long',
} as unknown as ConfigService;

describe('CryptoService', () => {
  const crypto = new CryptoService(fakeConfig);

  it('round-trips a secret', () => {
    const secret = 'JBSWY3DPEHPK3PXP';
    const encrypted = crypto.encrypt(secret);
    expect(encrypted).not.toContain(secret);
    expect(crypto.decrypt(encrypted)).toBe(secret);
  });

  it('produces a different ciphertext each time (random IV)', () => {
    expect(crypto.encrypt('same')).not.toBe(crypto.encrypt('same'));
  });

  it('fails to decrypt tampered ciphertext (GCM auth)', () => {
    const encrypted = crypto.encrypt('secret');
    const tampered = Buffer.from(encrypted, 'base64');
    const last = tampered.length - 1;
    tampered[last] = (tampered[last] ?? 0) ^ 0xff;
    expect(() => crypto.decrypt(tampered.toString('base64'))).toThrow();
  });
});
