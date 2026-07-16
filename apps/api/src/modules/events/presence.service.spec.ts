import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PRESENCE_AWAY_AFTER_MS } from '@cuks/shared';
import { PresenceService, derivePresence } from './presence.service';

type RedisCommand = () => unknown;

interface RedisMultiMock {
  zadd(key: string, score: number, member: string): RedisMultiMock;
  expire(key: string, seconds: number): RedisMultiMock;
  set(key: string, value: string, mode: 'EX', seconds: number): RedisMultiMock;
  zrem(key: string, member: string): RedisMultiMock;
  zremrangebyscore(key: string, minimum: '-inf', maximum: number): RedisMultiMock;
  zcard(key: string): RedisMultiMock;
  get(key: string): RedisMultiMock;
  exec(): Promise<readonly (readonly [null, unknown])[]>;
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
      expire: () => {
        commands.push(() => 'OK');
        return chain;
      },
      set: (key, value) => {
        commands.push(() => this.strings.set(key, value));
        return chain;
      },
      zrem: (key, member) => {
        commands.push(() => this.sortedSets.get(key)?.delete(member));
        return chain;
      },
      zremrangebyscore: (key, minimum, maximum) => {
        commands.push(() => void this.zremrangebyscore(key, minimum, maximum));
        return chain;
      },
      zcard: (key) => {
        commands.push(() => this.sortedSets.get(key)?.size ?? 0);
        return chain;
      },
      get: (key) => {
        commands.push(() => this.strings.get(key) ?? null);
        return chain;
      },
      exec: async () => commands.map((command) => [null, command()] as const),
    };
    return chain;
  }

  set(key: string, value: string): Promise<'OK'> {
    this.strings.set(key, value);
    return Promise.resolve('OK');
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

describe('derivePresence (docs/modules/13 §4)', () => {
  const NOW = Date.parse('2026-07-16T10:00:00.000Z');

  it('is offline without a live socket, keeping the last activity timestamp', () => {
    const at = NOW - 60_000;
    expect(derivePresence(0, at, NOW)).toEqual({
      status: 'offline',
      activityAt: new Date(at).toISOString(),
    });
    expect(derivePresence(0, null, NOW)).toEqual({ status: 'offline', activityAt: null });
  });

  it('is online while connected and active within the away window', () => {
    expect(derivePresence(2, NOW - (PRESENCE_AWAY_AFTER_MS - 1000), NOW).status).toBe('online');
    expect(derivePresence(1, NOW - PRESENCE_AWAY_AFTER_MS, NOW).status).toBe('online');
  });

  it('turns away once idle past the window, or with no recorded activity', () => {
    expect(derivePresence(1, NOW - (PRESENCE_AWAY_AFTER_MS + 1000), NOW).status).toBe('away');
    expect(derivePresence(1, null, NOW).status).toBe('away');
  });
});

describe('PresenceService.statusOf (docs/modules/13 §4)', () => {
  it('derives online / away / offline in one bulk read', async () => {
    const { redis, service } = makeService();
    await service.connect('u-online', 's1');
    await service.connect('u-away', 's2');
    const now = Date.now();
    // Age u-away's activity past the window (the socket stays fresh via its TTL score).
    await redis.set(
      'presence:user:u-away:activity',
      String(now - (PRESENCE_AWAY_AFTER_MS + 5_000)),
    );

    const statuses = await service.statusOf(['u-online', 'u-away', 'u-offline'], now);
    expect(statuses.map((s) => [s.userId, s.status])).toEqual([
      ['u-online', 'online'],
      ['u-away', 'away'],
      ['u-offline', 'offline'],
    ]);
  });

  it('fails open to offline when Redis is unavailable', async () => {
    const { redis, service } = makeService();
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(redis, 'multi').mockImplementation(() => {
      throw new Error('Redis unavailable');
    });
    const statuses = await service.statusOf(['a']);
    expect(statuses).toEqual([{ userId: 'a', status: 'offline', activityAt: null }]);
  });
});
