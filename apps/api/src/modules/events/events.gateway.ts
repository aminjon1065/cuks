import { Logger } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { SESSION_COOKIE, WS_NAMESPACE, wsRooms } from '@cuks/shared';
import { SessionService } from '../auth/session.service';
import { UsersService } from '../users/users.service';
import { RealtimeService } from './realtime.service';
import { PresenceService } from './presence.service';

/** Minimal cookie-header parser (the WS handshake isn't run through Fastify). */
export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name) out[name] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}

/**
 * Socket.IO gateway on namespace `/ws` (docs/01 §Realtime). Authorizes the
 * handshake with the same session cookie as REST, then joins the socket to its
 * `user:{id}` room so per-user events (notifications, call ring) reach every tab.
 * A blocked or session-less socket is disconnected immediately.
 */
@WebSocketGateway({ namespace: WS_NAMESPACE })
export class EventsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(EventsGateway.name);

  constructor(
    private readonly sessions: SessionService,
    private readonly users: UsersService,
    private readonly realtime: RealtimeService,
    private readonly presence: PresenceService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.bind(server);
  }

  async handleConnection(client: Socket): Promise<void> {
    const userId = await this.resolveUserId(client);
    if (!userId) {
      client.disconnect(true);
      return;
    }
    client.data.userId = userId;
    await client.join(wsRooms.user(userId));
    await this.presence.connect(userId, client.id);
    const permissions = await this.users.getPermissions(userId);
    if (permissions.isSuperadmin || permissions.permissions.includes('gis.view')) {
      await client.join(wsRooms.gis());
    }
    client.emit('connection.ready', { userId });
  }

  async handleDisconnect(client: Socket): Promise<void> {
    const userId = (client.data as { userId?: string }).userId;
    if (userId) {
      await this.presence.disconnect(client.id);
      this.logger.debug(`socket ${client.id} disconnected (user ${userId})`);
    }
  }

  /** Resolve the session cookie to an active, non-blocked user id, or null. */
  private async resolveUserId(client: Socket): Promise<string | null> {
    const cookies = parseCookieHeader(client.handshake.headers.cookie);
    const sessionId = cookies[SESSION_COOKIE];
    if (!sessionId) return null;

    const session = await this.sessions.get(sessionId);
    if (!session) return null;

    const user = await this.users.findActiveById(session.userId);
    if (!user || user.status === 'blocked') return null;
    return user.id;
  }
}
