import { describe, expect, it } from 'vitest';
import { TILE_TOKEN_TTL_SECONDS } from '@cuks/shared';
import { TileTokenService } from './tile-token.service';

const config = { get: (k: string) => (k === 'SESSION_SECRET' ? 's'.repeat(32) : undefined) };
const make = () => new TileTokenService(config as never);

describe('TileTokenService', () => {
  it('issues a token that verifies and carries the TTL expiry', () => {
    const svc = make();
    const now = 1_700_000_000_000;
    const { token, expiresAt } = svc.issue(now);
    expect(svc.verify(token, now)).toBe(true);
    expect(Math.round((expiresAt.getTime() - now) / 1000)).toBe(TILE_TOKEN_TTL_SECONDS);
  });

  it('rejects an expired token', () => {
    const svc = make();
    const now = 1_700_000_000_000;
    const { token } = svc.issue(now);
    expect(svc.verify(token, now + (TILE_TOKEN_TTL_SECONDS + 1) * 1000)).toBe(false);
  });

  it('rejects a tampered signature or expiry', () => {
    const svc = make();
    const { token } = svc.issue();
    const [exp, sig] = token.split('.');
    expect(svc.verify(`${exp}.${sig}x`)).toBe(false); // bad signature
    expect(svc.verify(`${Number(exp) + 999999}.${sig}`)).toBe(false); // exp not covered by sig
  });

  it('rejects malformed / empty tokens', () => {
    const svc = make();
    for (const t of ['', 'nodot', '.sig', '123.', 'abc.def', undefined, null]) {
      expect(svc.verify(t as never)).toBe(false);
    }
  });

  it('a token from a different secret does not verify', () => {
    const a = make();
    const b = new TileTokenService({ get: () => 'x'.repeat(32) } as never);
    expect(b.verify(a.issue().token)).toBe(false);
  });
});
