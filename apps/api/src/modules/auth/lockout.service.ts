import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import {
  AUTH_LOGIN_RATE_PER_MINUTE,
  LOCKOUT_MAX_ATTEMPTS,
  LOCKOUT_WINDOW_SECONDS,
} from '@cuks/shared';
import { REDIS } from '../../common/redis/redis.module';

/**
 * Anti-bruteforce lockout (docs/05 §1): 5 failed logins within the window lock
 * further attempts (counted per username AND per IP) for 15 minutes.
 */
@Injectable()
export class LockoutService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private key(kind: 'user' | 'ip', id: string): string {
    return `lockout:${kind}:${id}`;
  }

  async isLocked(username: string, ip: string): Promise<boolean> {
    const [byUser, byIp] = await this.redis.mget(this.key('user', username), this.key('ip', ip));
    return Number(byUser) >= LOCKOUT_MAX_ATTEMPTS || Number(byIp) >= LOCKOUT_MAX_ATTEMPTS;
  }

  async recordFailure(username: string, ip: string): Promise<void> {
    for (const key of [this.key('user', username), this.key('ip', ip)]) {
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, LOCKOUT_WINDOW_SECONDS);
      }
    }
  }

  async reset(username: string, ip: string): Promise<void> {
    await this.redis.del(this.key('user', username), this.key('ip', ip));
  }

  /** Per-IP login rate limit (docs/09 §1). Returns true when the limit is exceeded. */
  async isRateLimited(ip: string): Promise<boolean> {
    const key = `ratelimit:login:${ip}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 60);
    return count > AUTH_LOGIN_RATE_PER_MINUTE;
  }
}
