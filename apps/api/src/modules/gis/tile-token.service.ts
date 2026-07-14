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

  /** Mint a token `<exp>.<sig>` valid for TILE_TOKEN_TTL_SECONDS. */
  issue(now: number = Date.now()): { token: string; expiresAt: Date } {
    const exp = Math.floor(now / 1000) + TILE_TOKEN_TTL_SECONDS;
    return { token: `${exp}.${this.sign(String(exp))}`, expiresAt: new Date(exp * 1000) };
  }

  /** True if the token's signature is valid (timing-safe) and it has not expired. */
  verify(token: string | undefined | null, now: number = Date.now()): boolean {
    if (!token) return false;
    const dot = token.indexOf('.');
    if (dot <= 0) return false;
    const expStr = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    if (!/^\d+$/.test(expStr) || sig.length === 0) return false;

    const expected = Buffer.from(this.sign(expStr));
    const provided = Buffer.from(sig);
    if (provided.length !== expected.length) return false;
    if (!timingSafeEqual(provided, expected)) return false;

    return Number(expStr) * 1000 > now;
  }

  private sign(data: string): string {
    return createHmac('sha256', this.key).update(data).digest('base64url');
  }
}
