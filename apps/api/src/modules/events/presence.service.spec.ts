import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PresenceService } from './presence.service';

type RedisCommand = () => void;

interface RedisMultiMock {
  zadd(key: string, score: number, member: string): RedisMultiMock;
  expire(key: string, seconds: number): RedisMultiMock;
  set(key: string, value: string, mode: 'EX', seconds: number): RedisMultiMock;
  zrem(key: string, member: string): RedisMultiMock;
  exec(): Promise<readonly (readonly [null, 'OK'])[]>;
}

class RedisMock {
  private readonly sortedSets = new Map<string, Map<string, number>>();
  private readonly strings = new Map<string, string>();

  multi(): RedisMultiMock {
    const commands: RedisCommand[] = [];
    const chain: RedisMultiMock = {
      zadd: (key, score, member) => {
        commands.push(() => this.sortedSet(key).set(member, score));
        return chain;
      },
      expire: () => chain,
      set: (key, value) => {
        commands.push(() => this.strings.set(key, value));
        return chain;
      },
      zrem: (key, member) => {
        commands.push(() => this.sortedSets.get(key)?.delete(member));
        return chain;
      },
      exec: async () => {
        for (const command of commands) command();
        return commands.map(() => [null, 'OK'] as const);
      },
    };
    return chain;
  }

  async zremrangebyscore(key: string, _minimum: '-inf', maximum: number): Promise<number> {
    const set = this.sortedSets.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const [member, score] of set) {
      if (score <= maximum) {
        set.delete(member);
        removed += 1;
      }
    }
    return removed;
  }

  async zcard(key: string): Promise<number> {
    return this.sortedSets.get(key)?.size ?? 0;
  }

  async get(key: string): Promise<string | null> {
    return this.strings.get(key) ?? null;
  }

  lastSeen(userId: string): number {
    const value = this.strings.get(`presence:user:${userId}:last_seen`);
    if (value === undefined) throw new Error(`No last-seen value for ${userId}`);
    return Number(value);
  }

  private sortedSet(key: string): Map<string, number> {
    const current = this.sortedSets.get(key);
    if (current) return current;
    const created = new Map<string, number>();
    this.sortedSets.set(key, created);
    return created;
  }
}

function makeService() {
  const redis = new RedisMock();
  return { redis, service: new PresenceService(redis as never) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('PresenceService', () => {
  it('reports an active unexpired socket as online', async () => {
    const { redis, service } = makeService();
    await service.connect('user-online', 'socket-1');
    const lastSeen = redis.lastSeen('user-online');

    await expect(service.status('user-online', lastSeen + 89_999)).resolves.toEqual({
      online: true,
      offlineForMs: 0,
    });
  });

  it('reports the time offline after the last local socket disconnects', async () => {
    const { redis, service } = makeService();
    await service.connect('user-disconnected', 'socket-1');
    await service.disconnect('socket-1');
    const lastSeen = redis.lastSeen('user-disconnected');

    await expect(service.status('user-disconnected', lastSeen + 12_345)).resolves.toEqual({
      online: false,
      offlineForMs: 12_345,
    });
  });

  it('purges an expired socket and measures offline time from its last heartbeat', async () => {
    const { redis, service } = makeService();
    await service.connect('user-expired', 'socket-1');
    const lastSeen = redis.lastSeen('user-expired');

    await expect(service.status('user-expired', lastSeen + 90_001)).resolves.toEqual({
      online: false,
      offlineForMs: 90_001,
    });
  });

  it('treats a user with no presence record as long-offline', async () => {
    const { service } = makeService();

    await expect(service.status('user-never-seen', 1_000_000)).resolves.toEqual({
      online: false,
      offlineForMs: Number.POSITIVE_INFINITY,
    });
  });

  it('fails open as long-offline when Redis cannot be read', async () => {
    const { redis, service } = makeService();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(redis, 'zremrangebyscore').mockRejectedValue(new Error('Redis unavailable'));

    await expect(service.status('user-redis-error', 1_000_000)).resolves.toEqual({
      online: false,
      offlineForMs: Number.POSITIVE_INFINITY,
    });
  });
});
