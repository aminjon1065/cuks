import { describe, expect, it } from 'vitest';
import { TILE_TOKEN_TTL_SECONDS } from '@cuks/shared';
import { TileTokenService } from './tile-token.service';

const config = { get: (k: string) => (k === 'SESSION_SECRET' ? 's'.repeat(32) : undefined) };
const make = () => new TileTokenService(config as never);

describe('TileTokenService', () => {
  it('issues a global token that verifies to "all" and carries the TTL expiry', () => {
    const svc = make();
    const now = 1_700_000_000_000;
    const { token, expiresAt } = svc.issue('all', now);
    expect(svc.verify(token, now)).toBe('all');
    expect(Math.round((expiresAt.getTime() - now) / 1000)).toBe(TILE_TOKEN_TTL_SECONDS);
  });

  it('round-trips the region scope for a confined token', () => {
    const svc = make();
    const scope = svc.verify(svc.issue(['reg-b', 'reg-a']).token);
    expect(scope).toEqual(['reg-a', 'reg-b']); // sorted, tamper-proof
  });

  it('rejects an expired token', () => {
    const svc = make();
    const now = 1_700_000_000_000;
    const { token } = svc.issue('all', now);
    expect(svc.verify(token, now + (TILE_TOKEN_TTL_SECONDS + 1) * 1000)).toBeNull();
  });

  it('rejects a tampered signature, expiry or scope', () => {
    const svc = make();
    const { token } = svc.issue(['reg-a']);
    const [exp, scope, sig] = token.split('.');
    expect(svc.verify(`${exp}.${scope}.${sig}x`)).toBeNull(); // bad signature
    expect(svc.verify(`${Number(exp) + 999999}.${scope}.${sig}`)).toBeNull(); // exp not signed
    expect(svc.verify(`${exp}.all.${sig}`)).toBeNull(); // scope swapped to all
  });

  it('rejects malformed / empty tokens', () => {
    const svc = make();
    for (const t of ['', 'nodot', 'one.two', 'a.b.c.d', undefined, null]) {
      expect(svc.verify(t as never)).toBeNull();
    }
  });

  it('a token from a different secret does not verify', () => {
    const a = make();
    const b = new TileTokenService({ get: () => 'x'.repeat(32) } as never);
    expect(b.verify(a.issue().token)).toBeNull();
  });
});
