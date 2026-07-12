import { describe, expect, it } from 'vitest';
import { PasswordService } from './password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes with argon2id and verifies the correct password', async () => {
    const hash = await service.hash('correct horse battery');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await service.verify(hash, 'correct horse battery')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await service.hash('right');
    expect(await service.verify(hash, 'wrong')).toBe(false);
  });

  it('returns false on a malformed hash instead of throwing', async () => {
    expect(await service.verify('not-a-hash', 'x')).toBe(false);
  });
});
