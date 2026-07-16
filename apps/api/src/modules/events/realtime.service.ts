import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import { wsRooms, type WsEventName, type WsEventPayloads } from '@cuks/shared';

/**
 * Thin publish API over the Socket.IO server (docs/01 §Realtime). Feature modules
 * (notifications in 0.10, chat, calls, …) inject this to push events without
 * depending on the gateway. The gateway binds the live server via {@link bind}.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server: Server | null = null;

  bind(server: Server): void {
    this.server = server;
  }

  /** Push to every socket of one user (their `user:{id}` room). */
  emitToUser<E extends WsEventName>(userId: string, event: E, payload: WsEventPayloads[E]): void {
    this.server?.to(wsRooms.user(userId)).emit(event, payload);
  }

  /** Push to an arbitrary room (channel/board/entity — see {@link wsRooms}). */
  emitToRoom<E extends WsEventName>(room: string, event: E, payload: WsEventPayloads[E]): void {
    this.server?.to(room).emit(event, payload);
  }

  /** Broadcast to every authorized socket (presence transitions — docs/modules/13 §4). */
  emitToAll<E extends WsEventName>(event: E, payload: WsEventPayloads[E]): void {
    this.server?.emit(event, payload);
  }

  /** Kick every live socket of a user out of a room — membership revocations must cut the live feed
   *  too, not just future subscribes (docs/modules/13 §5). Works across instances via the adapter. */
  evictUserFromRoom(userId: string, room: string): void {
    this.server?.in(wsRooms.user(userId)).socketsLeave(room);
  }

  /** The user ids with a live socket in a room (docs/modules/13 §6) — lets chat skip notifying people
   *  who are already watching the channel. Cross-instance via the Redis adapter. Fails OPEN (returns
   *  empty): a transient adapter timeout must not silently suppress notifications — over-notifying a
   *  viewer is far better than dropping a mention, matching PresenceService's fail-open convention. */
  async userIdsInRoom(room: string): Promise<Set<string>> {
    const ids = new Set<string>();
    if (!this.server) return ids;
    try {
      const sockets = await this.server.in(room).fetchSockets();
      for (const socket of sockets) {
        const userId = (socket.data as { userId?: string }).userId;
        if (userId) ids.add(userId);
      }
    } catch (err) {
      this.logger.error({ err, room }, 'failed to read room membership; treating room as empty');
    }
    return ids;
  }
}
