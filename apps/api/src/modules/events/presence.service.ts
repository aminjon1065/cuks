import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { REDIS } from '../../common/redis/redis.module';

const HEARTBEAT_MS = 30_000;
const SOCKET_TTL_MS = 90_000;
const KEY_TTL_SECONDS = 7 * 24 * 60 * 60;

function socketsKey(userId: string): string {
  return `presence:user:${userId}:sockets`;
}

function lastSeenKey(userId: string): string {
  return `presence:user:${userId}:last_seen`;
}

export interface PresenceState {
  online: boolean;
  /** Infinity means the user has no recorded socket activity and is considered long-offline. */
  offlineForMs: number;
}

/**
 * Cross-process socket presence backed by expiring Redis sorted-set members.
 * Heartbeats make crashed API instances self-heal without a disconnect callback.
 */
@Injectable()
export class PresenceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PresenceService.name);
  private readonly instanceId = randomUUID();
  private readonly localSockets = new Map<string, string>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatRunning = false;

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  onModuleInit(): void {
    this.heartbeatTimer = setInterval(() => void this.heartbeat(), HEARTBEAT_MS);
    this.heartbeatTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  async connect(userId: string, socketId: string): Promise<void> {
    this.localSockets.set(socketId, userId);
    await this.refreshSocket(userId, socketId, Date.now());
  }

  async disconnect(socketId: string): Promise<void> {
    const userId = this.localSockets.get(socketId);
    if (!userId) return;
    this.localSockets.delete(socketId);
    const now = Date.now();
    try {
      await this.redis
        .multi()
        .zrem(socketsKey(userId), this.member(socketId))
        .set(lastSeenKey(userId), String(now), 'EX', KEY_TTL_SECONDS)
        .exec();
    } catch (err) {
      this.logger.error({ err, userId }, 'failed to record socket disconnect');
    }
  }

  async status(userId: string, now = Date.now()): Promise<PresenceState> {
    try {
      const key = socketsKey(userId);
      await this.redis.zremrangebyscore(key, '-inf', now);
      const [count, lastSeenRaw] = await Promise.all([
        this.redis.zcard(key),
        this.redis.get(lastSeenKey(userId)),
      ]);
      if (count > 0) return { online: true, offlineForMs: 0 };
      const lastSeen = lastSeenRaw ? Number(lastSeenRaw) : Number.NaN;
      return {
        online: false,
        offlineForMs: Number.isFinite(lastSeen)
          ? Math.max(0, now - lastSeen)
          : Number.POSITIVE_INFINITY,
      };
    } catch (err) {
      // Alerting fails open: when presence is unavailable, treat the recipient as
      // long-offline instead of silently suppressing an operational email.
      this.logger.error({ err, userId }, 'failed to read presence');
      return { online: false, offlineForMs: Number.POSITIVE_INFINITY };
    }
  }

  private async heartbeat(): Promise<void> {
    if (this.heartbeatRunning || this.localSockets.size === 0) return;
    this.heartbeatRunning = true;
    const now = Date.now();
    try {
      await Promise.all(
        [...this.localSockets].map(([socketId, userId]) =>
          this.refreshSocket(userId, socketId, now),
        ),
      );
    } finally {
      this.heartbeatRunning = false;
    }
  }

  private async refreshSocket(userId: string, socketId: string, now: number): Promise<void> {
    try {
      await this.redis
        .multi()
        .zadd(socketsKey(userId), now + SOCKET_TTL_MS, this.member(socketId))
        .expire(socketsKey(userId), KEY_TTL_SECONDS)
        .set(lastSeenKey(userId), String(now), 'EX', KEY_TTL_SECONDS)
        .exec();
    } catch (err) {
      this.logger.error({ err, userId }, 'failed to refresh socket presence');
    }
  }

  private member(socketId: string): string {
    return `${this.instanceId}:${socketId}`;
  }
}
