import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { TILE_TOKEN_TTL_SECONDS } from '@cuks/shared';
import { ConfigService } from '../../config/config.service';

const KEY_BYTES = 32;

/**
 * Short-lived signed tile-access tokens (docs/modules/10 §9). The api issues a
 * token on map load; Caddy `forward_auth` calls the validation endpoint before
 * proxying `/tiles/*` to Martin. HMAC-SHA256 over the expiry, keyed by a value
 * derived from SESSION_SECRET with domain separation (node:crypto only —
 * docs/09; same derivation style as CryptoService). The token carries no user
 * identity — it is a capability proving "issued by the api to a gis.view user",
 * cheap to verify statelessly and expiring within the hour.
 */
@Injectable()
export class TileTokenService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const secret = config.get('ENCRYPTION_KEY') ?? config.get('SESSION_SECRET');
    this.key = scryptSync(secret, 'cuks.tile-token.v1', KEY_BYTES);
  }

  /**
   * Mint a token `<exp>.<scope>.<sig>` valid for TILE_TOKEN_TTL_SECONDS. `scope`
   * encodes the region ids this user's incident tiles are confined to — the literal
   * `all` for a global/central user (task 2.13). The signature covers `exp.scope`,
   * so the scope cannot be tampered with.
   */
  issue(
    regionScope: 'all' | readonly string[] = 'all',
    now: number = Date.now(),
  ): { token: string; expiresAt: Date } {
    const exp = Math.floor(now / 1000) + TILE_TOKEN_TTL_SECONDS;
    const scope = encodeScope(regionScope);
    return {
      token: `${exp}.${scope}.${this.sign(`${exp}.${scope}`)}`,
      expiresAt: new Date(exp * 1000),
    };
  }

  /**
   * Validate a token and return its region scope, or `null` if invalid/expired.
   * `'all'` = unrestricted; an array = the only regions whose incident tiles the
   * bearer may fetch.
   */
  verify(token: string | undefined | null, now: number = Date.now()): 'all' | string[] | null {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [expStr, scope, sig] = parts as [string, string, string];
    if (!/^\d+$/.test(expStr) || scope.length === 0 || sig.length === 0) return null;

    const expected = Buffer.from(this.sign(`${expStr}.${scope}`));
    const provided = Buffer.from(sig);
    if (provided.length !== expected.length) return null;
    if (!timingSafeEqual(provided, expected)) return null;
    if (Number(expStr) * 1000 <= now) return null;

    return scope === 'all' ? 'all' : decodeScope(scope);
  }

  private sign(data: string): string {
    return createHmac('sha256', this.key).update(data).digest('base64url');
  }
}

/** `all` (unrestricted) or the sorted region ids, base64url-joined by comma. */
function encodeScope(scope: 'all' | readonly string[]): string {
  if (scope === 'all') return 'all';
  const ids = [...new Set(scope)].sort().join(',');
  return `r${Buffer.from(ids, 'utf8').toString('base64url')}`;
}

function decodeScope(encoded: string): string[] {
  const raw = Buffer.from(encoded.slice(1), 'base64url').toString('utf8');
  return raw.length === 0 ? [] : raw.split(',');
}
