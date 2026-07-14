import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import { ConfigService } from '../../config/config.service';
import { REDIS } from '../../common/redis/redis.module';

/**
 * Anti-bruteforce lockout (docs/05 §1): after `AUTH_LOCKOUT_MAX_ATTEMPTS` failed
 * logins within `AUTH_LOCKOUT_WINDOW_SECONDS`, further attempts are refused —
 * counted per username AND per IP. Defaults are the strict production values
 * (5 / 15 min); a dev environment may loosen them, and 0 attempts disables the
 * lockout (production is prevented from doing so — see env.ts).
 */
@Injectable()
export class LockoutService {
  private readonly maxAttempts: number;
  private readonly windowSeconds: number;

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService,
  ) {
    this.maxAttempts = config.get('AUTH_LOCKOUT_MAX_ATTEMPTS');
    this.windowSeconds = config.get('AUTH_LOCKOUT_WINDOW_SECONDS');
  }

  /** True when the lockout is turned off (dev convenience — `AUTH_LOCKOUT_MAX_ATTEMPTS=0`). */
  private get disabled(): boolean {
    return this.maxAttempts < 1;
  }

  private key(kind: 'user' | 'ip', id: string): string {
    return `lockout:${kind}:${id}`;
  }

  async isLocked(username: string, ip: string): Promise<boolean> {
    if (this.disabled) return false;
    const [byUser, byIp] = await this.redis.mget(this.key('user', username), this.key('ip', ip));
    return Number(byUser) >= this.maxAttempts || Number(byIp) >= this.maxAttempts;
  }

  async recordFailure(username: string, ip: string): Promise<void> {
    if (this.disabled) return;
    for (const key of [this.key('user', username), this.key('ip', ip)]) {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, this.windowSeconds);
      }
    }
  }

  async reset(username: string, ip: string): Promise<void> {
    await this.redis.del(this.key('user', username), this.key('ip', ip));
  }

  /**
   * Fixed-window rate limit for an arbitrary bucket (docs/09 §1). Returns true
   * when the request count in the window exceeds `limit`. Independent of the
   * login lockout above — used by the per-route ThrottleGuard.
   */
  async hitRate(bucket: string, limit: number, windowSeconds: number): Promise<boolean> {
    const key = `ratelimit:${bucket}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, windowSeconds);
    return count > limit;
  }
}
