import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

/**
 * Socket.IO adapter wired to Redis pub/sub (docs/01 §Realtime) so events fan out
 * across api processes (PM2 cluster on the same host). Also pins CORS to the app
 * origin with credentials, since the handshake carries the session cookie.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly adapterConstructor: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplicationContext,
    pubClient: Redis,
    subClient: Redis,
    private readonly origin: string,
  ) {
    super(app);
    this.adapterConstructor = createAdapter(pubClient, subClient);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.origin, credentials: true },
    }) as Server;
    server.adapter(this.adapterConstructor);
    return server;
  }
}
