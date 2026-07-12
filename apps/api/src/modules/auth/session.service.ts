import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type Redis from 'ioredis';
import {
  MAX_SESSIONS_PER_USER,
  SESSION_REMEMBER_TTL_SECONDS,
  SESSION_TTL_SECONDS,
  type SessionInfo,
} from '@cuks/shared';
import { REDIS } from '../../common/redis/redis.module';

export interface SessionData {
  userId: string;
  csrfToken: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastActivityAt: string;
  remember: boolean;
}

export interface CreatedSession {
  sessionId: string;
  csrfToken: string;
  ttlSeconds: number;
}

const token = (): string => randomBytes(32).toString('base64url');

/** Server-side sessions in Redis (docs/02 ADR-3, docs/05 §1). */
@Injectable()
export class SessionService {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  private sessionKey(id: string): string {
    return `session:${id}`;
  }

  private userKey(userId: string): string {
    return `user_sessions:${userId}`;
  }

  async create(
    userId: string,
    meta: { ip: string | null; userAgent: string | null; remember: boolean },
  ): Promise<CreatedSession> {
    const sessionId = token();
    const csrfToken = token();
    const now = new Date().toISOString();
    const ttlSeconds = meta.remember ? SESSION_REMEMBER_TTL_SECONDS : SESSION_TTL_SECONDS;
    const data: SessionData = {
      userId,
      csrfToken,
      ip: meta.ip,
      userAgent: meta.userAgent,
      createdAt: now,
      lastActivityAt: now,
      remember: meta.remember,
    };

    await this.redis.set(this.sessionKey(sessionId), JSON.stringify(data), 'EX', ttlSeconds);
    await this.redis.zadd(this.userKey(userId), Date.now(), sessionId);
    await this.enforceLimit(userId);

    return { sessionId, csrfToken, ttlSeconds };
  }

  async get(sessionId: string): Promise<SessionData | null> {
    const raw = await this.redis.get(this.sessionKey(sessionId));
    return raw ? (JSON.parse(raw) as SessionData) : null;
  }

  /** Sliding refresh: bump last activity and reset the TTL. */
  async refresh(sessionId: string, data: SessionData): Promise<void> {
    const ttlSeconds = data.remember ? SESSION_REMEMBER_TTL_SECONDS : SESSION_TTL_SECONDS;
    const updated: SessionData = { ...data, lastActivityAt: new Date().toISOString() };
    await this.redis.set(this.sessionKey(sessionId), JSON.stringify(updated), 'EX', ttlSeconds);
  }

  /** Revoke a session owned by the user. Returns true if it existed. */
  async revoke(userId: string, sessionId: string): Promise<boolean> {
    const removed = await this.redis.zrem(this.userKey(userId), sessionId);
    await this.redis.del(this.sessionKey(sessionId));
    return removed > 0;
  }

  /** Revoke all of the user's sessions except optionally one. Returns count removed. */
  async revokeAll(userId: string, exceptSessionId?: string): Promise<number> {
    const ids = await this.redis.zrange(this.userKey(userId), 0, -1);
    let removed = 0;
    for (const id of ids) {
      if (id === exceptSessionId) continue;
      await this.redis.del(this.sessionKey(id));
      await this.redis.zrem(this.userKey(userId), id);
      removed += 1;
    }
    return removed;
  }

  async list(userId: string, currentSessionId: string): Promise<SessionInfo[]> {
    const ids = await this.redis.zrange(this.userKey(userId), 0, -1);
    const result: SessionInfo[] = [];
    const stale: string[] = [];
    for (const id of ids) {
      const data = await this.get(id);
      if (!data) {
        stale.push(id);
        continue;
      }
      result.push({
        id,
        current: id === currentSessionId,
        ip: data.ip,
        userAgent: data.userAgent,
        createdAt: data.createdAt,
        lastActivityAt: data.lastActivityAt,
      });
    }
    if (stale.length > 0) await this.redis.zrem(this.userKey(userId), ...stale);
    return result;
  }

  /** Drop expired members, then evict the oldest sessions beyond the per-user cap. */
  private async enforceLimit(userId: string): Promise<void> {
    const ids = await this.redis.zrange(this.userKey(userId), 0, -1);
    const stale: string[] = [];
    for (const id of ids) {
      if ((await this.redis.exists(this.sessionKey(id))) === 0) stale.push(id);
    }
    if (stale.length > 0) await this.redis.zrem(this.userKey(userId), ...stale);

    let live = ids.length - stale.length;
    while (live > MAX_SESSIONS_PER_USER) {
      const [oldest] = await this.redis.zpopmin(this.userKey(userId));
      if (!oldest) break;
      await this.redis.del(this.sessionKey(oldest));
      live -= 1;
    }
  }
}
