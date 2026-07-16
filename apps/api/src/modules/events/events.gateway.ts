import { Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
  WebSocketGateway,
} from '@nestjs/websockets';
import { and, eq, isNull, or, sql } from 'drizzle-orm';
import type { Server, Socket } from 'socket.io';
import { SESSION_COOKIE, WS_NAMESPACE, wsRooms } from '@cuks/shared';
import {
  chatMembers,
  orgUnits,
  positions,
  taskProjectMembers,
  taskProjects,
  userPositions,
  type Database,
} from '@cuks/db';
import { DB } from '../../common/db/db.module';
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
    @Inject(DB) private readonly db: Database,
  ) {}

  /** Join a task board's room to receive its live updates (docs/modules/15 §3). Gated by the same
   *  view rule as the HTTP board fetch (TasksAclService.canView): a project member, a superadmin,
   *  or — when the project is «виден подразделению» — a user in the project's org-unit subtree. */
  @SubscribeMessage('board.subscribe')
  async subscribeBoard(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { projectId?: string },
  ): Promise<{ ok: boolean }> {
    const userId = (client.data as { userId?: string }).userId;
    const projectId = body?.projectId;
    if (!userId || !projectId) return { ok: false };
    if (!(await this.canViewBoard(userId, projectId))) return { ok: false };
    await client.join(wsRooms.board(projectId));
    return { ok: true };
  }

  /** Mirror of TasksAclService.canView, resolved directly here to keep the events module free of a
   *  dependency on the tasks module. */
  private async canViewBoard(userId: string, projectId: string): Promise<boolean> {
    const [member] = await this.db
      .select({ id: taskProjectMembers.id })
      .from(taskProjectMembers)
      .where(
        and(eq(taskProjectMembers.projectId, projectId), eq(taskProjectMembers.userId, userId)),
      )
      .limit(1);
    if (member) return true;
    const perms = await this.users.getPermissions(userId);
    if (perms.isSuperadmin) return true;
    const [project] = await this.db
      .select({ orgUnitId: taskProjects.orgUnitId, visible: taskProjects.visibleToOrgUnit })
      .from(taskProjects)
      .where(and(eq(taskProjects.id, projectId), isNull(taskProjects.deletedAt)))
      .limit(1);
    if (!project?.visible || !project.orgUnitId) return false;
    const [ou] = await this.db
      .select({ path: orgUnits.path })
      .from(orgUnits)
      .where(eq(orgUnits.id, project.orgUnitId))
      .limit(1);
    if (!ou) return false;
    const [hit] = await this.db
      .select({ id: positions.id })
      .from(userPositions)
      .innerJoin(
        positions,
        and(eq(positions.id, userPositions.positionId), isNull(positions.deletedAt)),
      )
      .innerJoin(orgUnits, eq(orgUnits.id, positions.orgUnitId))
      .where(
        and(
          eq(userPositions.userId, userId),
          or(eq(orgUnits.id, project.orgUnitId), sql`${orgUnits.path} like ${`${ou.path}.%`}`),
        ),
      )
      .limit(1);
    return !!hit;
  }

  @SubscribeMessage('board.unsubscribe')
  async unsubscribeBoard(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { projectId?: string },
  ): Promise<{ ok: boolean }> {
    if (body?.projectId) await client.leave(wsRooms.board(body.projectId));
    return { ok: true };
  }

  /** Join a chat channel's room to receive its live messages (docs/modules/13 §5) — members only,
   *  the same rule the REST message endpoints enforce. */
  @SubscribeMessage('channel.subscribe')
  async subscribeChannel(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { channelId?: string },
  ): Promise<{ ok: boolean }> {
    const userId = (client.data as { userId?: string }).userId;
    const channelId = body?.channelId;
    if (!userId || !channelId) return { ok: false };
    const [member] = await this.db
      .select({ id: chatMembers.id })
      .from(chatMembers)
      .where(and(eq(chatMembers.channelId, channelId), eq(chatMembers.userId, userId)))
      .limit(1);
    if (!member) return { ok: false };
    await client.join(wsRooms.channel(channelId));
    return { ok: true };
  }

  @SubscribeMessage('channel.unsubscribe')
  async unsubscribeChannel(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { channelId?: string },
  ): Promise<{ ok: boolean }> {
    if (body?.channelId) await client.leave(wsRooms.channel(body.channelId));
    return { ok: true };
  }

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
